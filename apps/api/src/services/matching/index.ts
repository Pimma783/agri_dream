// Layer: services. System job `recompute_matches` (Requirement 7.7, design.md "Persistence and recompute").
// There is no actor: the job is not a user action, so it does not call authorize() and writes audit rows
// through auditSystem. Everything runs in one transaction, and the clock is read once and passed to the pure engine.
import { z } from 'zod';
import { D } from '../../domain/units.js';
import { runMatching } from '../../matching/index.js';
import { RULES_V1 } from '../../matching/rules/v1.js';
import type {
  DemandSubject, Material, MatchResult, Price, PriceUnit, Route, SupplySubject, TimeWindow, TransportResponsibility,
} from '../../matching/types.js';
import {
  balingRequests, balingServices, demands, listings, matches, organizations,
  type BalingRequest, type BalingService, type Db, type Demand, type Listing,
} from '../../repos/index.js';
import { auditSystem } from '../audit.js';
import { inTransaction, nowOf, type ServiceContext } from '../context.js';
import { appError } from '../errors.js';
import { ok, err, type Result } from '../result.js';
import type { MatchEntityType } from '../recompute.js';

const PayloadSchema = z
  .object({
    entity_type: z.enum(['LISTING', 'DEMAND', 'BALING_SERVICE', 'BALING_REQUEST']),
    entity_id: z.uuid(),
    version: z.number().int().min(1),
  })
  .strict();

export interface RecomputeSummary {
  entityType: MatchEntityType;
  entityId: string;
  upserted: number;
  removed: number;
}
export interface MatchingService {
  /** Recompute every match that involves one entity. Idempotent: a second run leaves identical rows. */
  recompute(payload: unknown): Promise<Result<RecomputeSummary>>;
}

const MATERIAL: Record<string, Material> = {
  RICE_STRAW: 'RICE_STRAW', CANE_LEAF: 'SUGARCANE_TRASH', CORN_COB: 'CORN_STOVER', OTHER: 'OTHER',
};
const TRANSPORT: Record<string, TransportResponsibility | null> = {
  SELLER: 'SELLER_DELIVERS', BUYER: 'BUYER_PICKS_UP', EITHER: 'EITHER', UNKNOWN: null,
};
const material = (m: string): Material => MATERIAL[m] ?? 'OTHER';
const num = (s: string | null): number | null => (s === null ? null : Number(s));
const point = (lat: string | null, lng: string | null) => (lat !== null && lng !== null ? { lat: Number(lat), lng: Number(lng) } : null);
const window_ = (from: Date | null, to: Date | null): TimeWindow | null => (from && to ? { from, to } : null);
function price(mode: string, amount: string | null, unit: string | null): Price {
  const u: PriceUnit | null = unit === 'KG' ? 'THB_PER_KG' : unit === 'TON' ? 'THB_PER_TON' : unit === 'BALE' ? 'THB_PER_BALE' : null;
  return { negotiable: mode === 'NEGOTIABLE', amount: amount === null ? null : new D(amount), unit: u };
}
function maxMoisture(q: Record<string, unknown>): InstanceType<typeof D> | null {
  const v = q.max_moisture_pct;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? new D(n) : null;
}

interface Versioned<S> { subject: S; version: number; isDemo: boolean }

const listingSupply = (l: Listing): Versioned<SupplySubject> => ({
  version: l.version, isDemo: l.is_demo,
  subject: {
    id: l.id, orgId: l.org_id, published: l.status === 'PUBLISHED', material: material(l.material_type), form: l.material_form,
    remainingKg: new D(l.remaining_qty_kg), minLotKg: null, window: window_(l.available_from, l.available_to),
    location: point(l.lat, l.lng), province: l.province, price: price(l.price_mode, l.unit_price_thb, l.price_unit),
    kind: l.kind, transport: TRANSPORT[l.transport_by] ?? null,
  },
});
const requestSupply = (r: BalingRequest): Versioned<SupplySubject> => ({
  version: r.version, isDemo: r.is_demo,
  subject: {
    id: r.id, orgId: r.org_id, published: r.status === 'PUBLISHED', material: material(r.material_type), form: null,
    remainingKg: new D(r.qty_kg), minLotKg: null, window: window_(r.needed_from, r.needed_to),
    location: point(r.lat, r.lng), province: r.province, price: null, kind: 'BALING_REQUEST',
    balingMode: r.requested_mode === 'ON_SITE' ? 'ON_SITE' : 'OFF_SITE',
  },
});
/** One demand subject per accepted material, so the engine compares like with like. */
const demandSubject = (d: Demand, mat: Material): Versioned<DemandSubject> => ({
  version: d.version, isDemo: d.is_demo,
  subject: {
    id: d.id, orgId: d.org_id, published: d.status === 'PUBLISHED', material: mat, forms: d.accepted_forms,
    remainingKg: new D(d.remaining_qty_kg), minLotKg: d.min_lot_kg === null ? null : new D(d.min_lot_kg),
    window: window_(d.window_from, d.window_to), location: point(d.lat, d.lng), radiusKm: num(d.radius_km),
    provinces: d.accepted_provinces, price: price(d.price_mode, d.max_unit_price_thb, d.price_unit),
    maxMoisturePct: maxMoisture(d.quality), transport: TRANSPORT[d.transport_by] ?? null,
  },
});
/** A baling service has no "remaining" quantity: capacity is scored when known, and the request quantity stands in for the filter only. */
const serviceDemand = (s: BalingService, mat: Material, requestKg: InstanceType<typeof D>): Versioned<DemandSubject> => ({
  version: s.version, isDemo: s.is_demo,
  subject: {
    id: s.id, orgId: s.org_id, published: s.status === 'PUBLISHED', material: mat, forms: [],
    remainingKg: s.capacity_kg !== null && new D(s.capacity_kg).greaterThan(0) ? new D(s.capacity_kg) : requestKg,
    minLotKg: s.min_qty_kg === null ? null : new D(s.min_qty_kg), window: window_(s.available_from, s.available_to),
    location: point(s.lat, s.lng), radiusKm: null, provinces: s.service_provinces,
    price: price(s.price_mode, s.unit_price_thb, s.price_unit),
    balingModes: s.service_mode === 'BOTH' ? ['ON_SITE', 'OFF_SITE'] : [s.service_mode === 'ON_SITE' ? 'ON_SITE' : 'OFF_SITE'],
    baleFormats: s.baling_format ? [s.baling_format] : [],
    capacityKg: s.capacity_kg === null ? null : new D(s.capacity_kg),
  },
});

type Side = 'supply' | 'demand';
interface Scope { side: Side; routes: Route[] }

export function createMatchingService(ctx: ServiceContext): MatchingService {
  async function orgKind(db: Db, cache: Map<string, string | null>, id: string): Promise<string | null> {
    if (!cache.has(id)) cache.set(id, (await organizations.get(db, id))?.kind ?? null);
    return cache.get(id) ?? null;
  }

  async function run(db: Db, type: MatchEntityType, id: string, now: Date): Promise<RecomputeSummary> {
    const kinds = new Map<string, string | null>();
    const open = (status: string, remaining: string | null) => status === 'PUBLISHED' && (remaining === null || new D(remaining).greaterThan(0));
    let scope: Scope;
    // Entity row (null when missing or not open: such an entity matches nothing and its rows are removed).
    let entityListing: Listing | null = null;
    let entityDemand: Demand | null = null;
    let entityService: BalingService | null = null;
    let entityRequest: BalingRequest | null = null;
    if (type === 'LISTING') {
      const row = await listings.get(db, id);
      scope = { side: 'supply', routes: row?.kind === 'RESALE' ? [4] : row ? [1, 2] : [1, 2, 4] };
      if (row && open(row.status, row.remaining_qty_kg)) entityListing = row;
    } else if (type === 'DEMAND') {
      const row = await demands.get(db, id);
      const k = row ? await orgKind(db, kinds, row.org_id) : null;
      scope = { side: 'demand', routes: row ? (k === 'BUYER_FACTORY' ? [1, 4] : k === 'BALER' ? [2] : []) : [1, 2, 4] };
      if (row && open(row.status, row.remaining_qty_kg)) entityDemand = row;
    } else if (type === 'BALING_SERVICE') {
      const row = await balingServices.get(db, id);
      scope = { side: 'demand', routes: [3] };
      if (row && open(row.status, null)) entityService = row;
    } else {
      const row = await balingRequests.get(db, id);
      scope = { side: 'supply', routes: [3] };
      if (row && open(row.status, row.qty_kg)) entityRequest = row;
    }

    const pairs: MatchResult[] = [];
    const meta = new Map<string, { sv: number; dv: number; demo: boolean }>();
    const keyOf = (route: number, s: string, d: string) => `${route}:${s}:${d}`;
    const addAll = (route: Route, supplies: Versioned<SupplySubject>[], mkDemands: (s: SupplySubject) => Versioned<DemandSubject>[]) => {
      for (const s of supplies) {
        if (s.subject.material === 'OTHER') continue; // unconfirmed OTHER never matches
        const ds = mkDemands(s.subject);
        const byId = new Map(ds.map((d) => [d.subject.id, d]));
        for (const r of runMatching({ route, supplies: [s.subject], demands: ds.map((d) => d.subject), config: RULES_V1, now })) {
          const d = byId.get(r.demandId);
          if (!d) continue;
          pairs.push(r);
          meta.set(keyOf(route, r.supplyId, r.demandId), { sv: s.version, dv: d.version, demo: s.isDemo && d.isDemo });
        }
      }
    };
    const factoryOrBaler = async (rows: Demand[], kind: 'BUYER_FACTORY' | 'BALER') => {
      const out: Demand[] = [];
      for (const d of rows) if ((await orgKind(db, kinds, d.org_id)) === kind) out.push(d);
      return out;
    };
    const demandRows = async (kind: 'BUYER_FACTORY' | 'BALER'): Promise<Demand[]> =>
      entityDemand ? ((await orgKind(db, kinds, entityDemand.org_id)) === kind ? [entityDemand] : [])
        : scope.side === 'demand' ? [] : factoryOrBaler((await demands.listPublished(db)).filter((d) => new D(d.remaining_qty_kg).greaterThan(0)), kind);
    const demandsFor = (rows: Demand[]) => (s: SupplySubject) =>
      rows.filter((d) => d.accepted_materials.some((m) => material(m) === s.material)).map((d) => demandSubject(d, s.material));
    const listingRows = async (kind: 'SALE' | 'RESALE'): Promise<Listing[]> =>
      entityListing ? (entityListing.kind === kind ? [entityListing] : [])
        : scope.side === 'supply' ? [] : (await listings.listPublished(db)).filter((l) => l.kind === kind && new D(l.remaining_qty_kg).greaterThan(0));

    for (const route of scope.routes) {
      if (route === 1 || route === 2) {
        const rows = await demandRows(route === 1 ? 'BUYER_FACTORY' : 'BALER');
        addAll(route, (await listingRows('SALE')).map(listingSupply), demandsFor(rows));
      } else if (route === 4) {
        const rows = await demandRows('BUYER_FACTORY');
        addAll(4, (await listingRows('RESALE')).map(listingSupply), demandsFor(rows));
      } else {
        const reqs = entityRequest ? [entityRequest] : scope.side === 'demand' ? (await balingRequests.listPublished(db)) : [];
        const svcs = entityService ? [entityService] : scope.side === 'supply' ? (await balingServices.listPublished(db)) : [];
        addAll(3, reqs.map(requestSupply), (s) =>
          svcs.filter((v) => v.material_types.some((m) => material(m) === s.material)).map((v) => serviceDemand(v, s.material, s.remainingKg)));
      }
    }

    let upserted = 0;
    for (const r of pairs) {
      const m = meta.get(keyOf(r.route, r.supplyId, r.demandId))!;
      await matches.upsert(db, {
        route: r.route, supply_id: r.supplyId, demand_id: r.demandId, rule_version: r.ruleVersion, score: r.score,
        weight_coverage: r.weightCoverage, components: r.components, flags: r.flags, reasons: r.reasons,
        distance_km: r.distanceKm, supply_version: m.sv, demand_version: m.dv, tier: r.tier, is_demo: m.demo,
      });
      upserted += 1;
    }
    // Rows of this entity that were not produced by this run no longer pass the filters, or the entity is closed.
    let removed = 0;
    if (scope.routes.length > 0) {
      for (const route of scope.routes) {
        const keepIds = pairs.filter((p) => p.route === route).map((p) => (scope.side === 'supply' ? p.demandId : p.supplyId));
        removed += await matches.deleteExcept(db, { side: scope.side, entityId: id, routes: [route], keepRuleVersion: RULES_V1.version, keepIds });
      }
    }
    return { entityType: type, entityId: id, upserted, removed };
  }

  return {
    async recompute(payload) {
      const parsed = PayloadSchema.safeParse(payload);
      if (!parsed.success) return err(appError('VALIDATION'));
      const { entity_type, entity_id, version } = parsed.data;
      const now = nowOf(ctx);
      return inTransaction(ctx, async (tx) => {
        // Serialize recomputes of one entity so two workers cannot interleave their delete and upsert steps.
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`recompute_matches:${entity_id}`]);
        const summary = await run(tx, entity_type, entity_id, now);
        await auditSystem(tx, {
          action: 'matches.recomputed', entityType: entity_type.toLowerCase(), entityId: entity_id, entityVersion: version,
          detail: { upserted: summary.upserted, removed: summary.removed, rule_version: RULES_V1.version },
        });
        return ok(summary);
      });
    },
  };
}
