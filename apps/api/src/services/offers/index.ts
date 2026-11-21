// Layer: services. Offers (Requirement 11): create, edit (withdraw + create), reject, withdraw, read, expire.
// Accepting an offer (Requirement 12, 13) is delegated to `OfferAcceptor`; the default is accept.ts. This file never
// writes agreements, quantities or the ledger.
import { computeOfferTotal } from '../../domain/offer-terms.js';
import type { Actor } from '../../domain/permissions.js';
import { offerMachine } from '../../domain/state/index.js';
import { kg, kgToDb, money, moneyToDb } from '../../domain/units.js';
import {
  type Offer, balingRequests, balingServices, demands, listings, matches, offers, type Tx,
} from '../../repos/index.js';
import { audit, auditSystem } from '../audit.js';
import { authorized, checkVersion, inTransaction, nowOf, registerService, type ServiceContext } from '../context.js';
import { appError } from '../errors.js';
import { type Idempotent, withIdempotency } from '../idempotency.js';
import { err, mapResult, ok, type Result } from '../result.js';
import { createOfferAcceptor } from './accept.js';
import { notifyOrg, type OfferEvent } from './notify.js';
import {
  type CreateOfferInput, CreateOfferSchema, type EditOfferInput, EditOfferSchema, idempotencyKeySchema,
  type OfferRefInput, OfferRefSchema, validation,
} from './schemas.js';

registerService('offers.send', 'OFFER_SEND');
registerService('offers.read', 'OFFER_READ');
registerService('offers.respond', 'OFFER_RESPOND');
registerService('offers.withdraw', 'OFFER_WITHDRAW');
registerService('offers.edit', 'OFFER_WITHDRAW');

export { offerText, type OfferEvent } from './notify.js';
export type { AcceptResult } from './accept.js';
export type { CreateOfferInput, EditOfferInput, OfferRefInput } from './schemas.js';

export const DEFAULT_OFFER_EXPIRY_HOURS = 72;

export interface OfferResult {
  offer: Offer;
  /** Edit only: the old offer, now WITHDRAWN. */
  replaced?: Offer;
  /** True when an Idempotency-Key replay returned the stored outcome. */
  replayed: boolean;
}

export interface AcceptOfferInput {
  offerId: string;
  idempotencyKey?: string;
  ackPendingMaterial?: boolean;
}

/**
 * The service authorizes the actor as the receiver (OFFER_RESPOND) and then delegates the whole
 * accept transaction (locks, agreement, ledger, outbox, audit) to this function.
 */
export type OfferAcceptor = (actor: Actor, input: AcceptOfferInput) => Promise<Result<unknown>>;

export interface OfferServiceOptions {
  /** Default lifetime of a new offer, from config OFFER_EXPIRY_HOURS. */
  defaultExpiryHours?: number;
  /** Replaces the default accept transaction (tests only). */
  acceptor?: OfferAcceptor;
}

export interface MutateOptions {
  /** Idempotency-Key header value. */
  idempotencyKey?: string;
}

export interface ListOffersFilter {
  status?: Offer['status'];
  direction?: 'sent' | 'received';
}

export interface OfferService {
  create(actor: Actor, input: CreateOfferInput, o?: MutateOptions): Promise<Result<OfferResult>>;
  /** Withdraw the PENDING offer and create a new PENDING one with the changed terms, in one transaction. */
  edit(actor: Actor, input: EditOfferInput, o?: MutateOptions): Promise<Result<OfferResult>>;
  reject(actor: Actor, input: OfferRefInput, o?: MutateOptions): Promise<Result<OfferResult>>;
  withdraw(actor: Actor, input: OfferRefInput, o?: MutateOptions): Promise<Result<OfferResult>>;
  /** Receiver only. Runs the accept transaction (accept.ts). */
  accept(actor: Actor, input: AcceptOfferInput): Promise<Result<unknown>>;
  /** Sender or receiver; any other organization gets NOT_FOUND. */
  get(actor: Actor, id: string): Promise<Result<Offer>>;
  list(actor: Actor, filter?: ListOffersFilter): Promise<Result<Offer[]>>;
  /** System sweeper: PENDING offers past their expiry become EXPIRED. Returns how many changed. */
  expireDue(now?: Date, limit?: number): Promise<number>;
}

type InsertValues = Parameters<typeof offers.insert>[1];
type Refs = Pick<Offer, 'kind' | 'listing_id' | 'demand_id' | 'baling_service_id' | 'baling_request_id'>;
interface Terms {
  qtyKg: string;
  unitPriceThb: string | null;
  priceUnit: 'KG' | 'TON' | 'BALE' | null;
  transportBy: Offer['transport_by'];
  transportCostThb: string | null;
  readyDate: string | null;
  expiresAt: Date | null;
  ack: boolean;
}
/** JSON-safe outcome stored for Idempotency-Key replay. The rows are reloaded on return. */
interface Stored { offerId: string; replacedOfferId?: string }

const bad = (path: string, message: string) => err(appError('VALIDATION', { fields: [{ path, message }] }));
const invalidState = (entity: string, state: string) => err(appError('INVALID_STATE', { details: { entity, state } }));

export function createOfferService(ctx: ServiceContext, opts: OfferServiceOptions = {}): OfferService {
  const expiryHours = opts.defaultExpiryHours ?? DEFAULT_OFFER_EXPIRY_HOURS;
  const acceptor = opts.acceptor ?? createOfferAcceptor(ctx);

  // ---- building a new offer from referenced rows ----

  async function prepare(tx: Tx, actor: Actor, refs: Refs, t: Terms, now: Date): Promise<Result<InsertValues>> {
    const expiresAt = t.expiresAt ?? new Date(now.getTime() + expiryHours * 3600_000);
    if (expiresAt.getTime() <= now.getTime()) return bad('expiresAt', 'วันหมดอายุต้องอยู่ในอนาคต');
    const qty = kg(t.qtyKg);
    if (!qty.gt(0)) return bad('qtyKg', 'ปริมาณต้องมากกว่า 0');
    const price = t.unitPriceThb !== null && t.priceUnit !== null ? { unit_price_thb: moneyToDb(money(t.unitPriceThb)), price_unit: t.priceUnit } : { unit_price_thb: null, price_unit: null };
    const common = {
      qty_kg: kgToDb(qty),
      ...price,
      total_amount_thb: computeOfferTotal(kgToDb(qty), price.unit_price_thb, price.price_unit),
      transport_by: t.transportBy,
      transport_cost_thb: t.transportCostThb !== null ? moneyToDb(money(t.transportCostThb), 2) : null,
      ready_date: t.readyDate,
      expires_at: expiresAt,
      status: 'PENDING' as const,
    };

    if (refs.kind === 'PURCHASE') {
      if (!refs.listing_id || !refs.demand_id) return bad('listingId', 'ต้องระบุประกาศขายและความต้องการซื้อ');
      if (t.priceUnit === 'BALE') return bad('priceUnit', 'ข้อเสนอซื้อขายใช้หน่วยราคา กก. หรือ ตัน');
      const listing = await listings.get(tx, refs.listing_id);
      const demand = await demands.get(tx, refs.demand_id);
      if (!listing || !demand) return err(appError('NOT_FOUND'));
      const ownsListing = listing.org_id === actor.orgId;
      const ownsDemand = demand.org_id === actor.orgId;
      if (!ownsListing && !ownsDemand) return err(appError('NOT_FOUND'));
      if (listing.org_id === demand.org_id) return bad('demandId', 'ผู้ส่งและผู้รับเป็นองค์กรเดียวกัน');
      if (listing.status !== 'PUBLISHED') return invalidState('listing', listing.status);
      if (demand.status !== 'PUBLISHED') return invalidState('demand', demand.status);
      if (qty.gt(kg(listing.remaining_qty_kg)) || qty.gt(kg(demand.remaining_qty_kg))) return err(appError('INSUFFICIENT_QUANTITY'));
      if (demand.min_lot_kg !== null && qty.lt(kg(demand.min_lot_kg))) return bad('qtyKg', 'ปริมาณน้อยกว่าขั้นต่ำต่อล็อตของผู้ซื้อ');
      // Requirement 14.11: material that is not yet received or baled must be acknowledged on the offer.
      if (listing.pending_material && !t.ack) return bad('ackPendingMaterial', 'ต้องรับทราบว่าวัสดุอยู่ระหว่างรอรับ/รออัด');
      return ok({
        ...common,
        kind: 'PURCHASE',
        from_org_id: actor.orgId,
        to_org_id: ownsListing ? demand.org_id : listing.org_id,
        listing_id: listing.id,
        demand_id: demand.id,
        listing_version: listing.version,
        demand_version: demand.version,
        ack_pending_material: listing.pending_material ? t.ack : false,
        is_demo: listing.is_demo || demand.is_demo,
      });
    }

    if (!refs.baling_service_id || !refs.baling_request_id) return bad('balingServiceId', 'ต้องระบุบริการอัดและคำขอใช้บริการ');
    const service = await balingServices.get(tx, refs.baling_service_id);
    const request = await balingRequests.get(tx, refs.baling_request_id);
    if (!service || !request) return err(appError('NOT_FOUND'));
    const ownsService = service.org_id === actor.orgId;
    const ownsRequest = request.org_id === actor.orgId;
    if (!ownsService && !ownsRequest) return err(appError('NOT_FOUND'));
    if (service.org_id === request.org_id) return bad('balingRequestId', 'ผู้ส่งและผู้รับเป็นองค์กรเดียวกัน');
    if (service.status !== 'PUBLISHED') return invalidState('baling_service', service.status);
    if (request.status !== 'PUBLISHED') return invalidState('baling_request', request.status);
    if (qty.gt(kg(request.qty_kg))) return bad('qtyKg', 'ปริมาณเกินที่ขอใช้บริการ');
    if (service.min_qty_kg !== null && qty.lt(kg(service.min_qty_kg))) return bad('qtyKg', 'ปริมาณน้อยกว่าขั้นต่ำของบริการ');
    return ok({
      ...common,
      kind: 'BALING_SERVICE',
      from_org_id: actor.orgId,
      to_org_id: ownsService ? request.org_id : service.org_id,
      baling_service_id: service.id,
      baling_request_id: request.id,
      ack_pending_material: false,
      is_demo: service.is_demo || request.is_demo,
    });
  }

  /**
   * A stored match supplies the referenced pair. Route 3 is baling; routes 1, 2 and 4 are trade.
   * On route 3 the farmer's request is the supply side and the baler's service is the demand side (matching/recompute).
   */
  async function refsFromMatch(tx: Tx, matchId: string, kind: Offer['kind']): Promise<Result<Refs & { supplyVersion: number | null; demandVersion: number | null }>> {
    const m = await matches.get(tx, matchId);
    if (!m) return err(appError('NOT_FOUND'));
    const isBaling = m.route === 3;
    if ((kind === 'BALING_SERVICE') !== isBaling) return bad('kind', 'ประเภทข้อเสนอไม่ตรงกับผลจับคู่');
    const base = { supplyVersion: m.supply_version, demandVersion: m.demand_version };
    return ok(
      isBaling
        ? { ...base, kind, listing_id: null, demand_id: null, baling_service_id: m.demand_id, baling_request_id: m.supply_id }
        : { ...base, kind, listing_id: m.supply_id, demand_id: m.demand_id, baling_service_id: null, baling_request_id: null },
    );
  }

  async function insertOffer(tx: Tx, actor: Actor, v: InsertValues, extra: { supersedes?: string | undefined; key?: string | undefined }): Promise<Offer> {
    const row = await offers.insert(tx, { ...v, supersedes_offer_id: extra.supersedes ?? null, idempotency_key: extra.key ?? null });
    await audit(tx, actor, {
      action: 'offer.created',
      entityType: 'offer',
      entityId: row.id,
      entityVersion: row.version,
      detail: { kind: row.kind, qty_kg: row.qty_kg, to_org_id: row.to_org_id, supersedes: row.supersedes_offer_id },
    });
    return row;
  }

  // ---- shared plumbing ----

  /** One transaction, or the same inside an Idempotency-Key claim. */
  async function mutate(
    actor: Actor, scope: string, key: string | undefined, request: unknown, fn: (tx: Tx) => Promise<Result<Stored>>,
  ): Promise<Result<OfferResult>> {
    let r: Result<Idempotent<Stored>>;
    if (key === undefined) {
      r = await inTransaction(ctx, async (tx) => mapResult(await fn(tx), (value) => ({ value, replayed: false })));
    } else {
      const k = idempotencyKeySchema.safeParse(key);
      if (!k.success) return err(validation(k.error.issues));
      r = await withIdempotency(ctx, { orgId: actor.orgId, scope, key, request }, fn);
    }
    if (!r.ok) return r;
    const offer = await offers.get(ctx.pool, r.value.value.offerId);
    if (!offer) return err(appError('NOT_FOUND'));
    const rid = r.value.value.replacedOfferId;
    const replaced = rid ? await offers.get(ctx.pool, rid) : null;
    return ok({ offer, ...(replaced ? { replaced } : {}), replayed: r.value.replayed });
  }

  /** PENDING-only transition. Wrong state: INVALID_STATE with the current state. Past expiry: OFFER_EXPIRED. */
  async function moveFrom(tx: Tx, row: Offer, event: 'REJECT' | 'WITHDRAW', now: Date, expectedVersion?: number): Promise<Result<Offer>> {
    const t = offerMachine.next(row.status, event);
    if (!t.ok) return err(appError('INVALID_STATE', { details: { state: row.status } }));
    if (row.expires_at.getTime() <= now.getTime()) return err(appError('OFFER_EXPIRED'));
    if (expectedVersion !== undefined) {
      const v = checkVersion(expectedVersion, row.version);
      if (!v.ok) return err(v.error);
    }
    const updated = await offers.update(tx, row.id, { status: t.state }, { expectedVersion: row.version });
    return updated ? ok(updated) : err(appError('STALE_VERSION'));
  }

  const resourceOf = (o: Offer | null) => (o ? { orgId: o.from_org_id, receiverOrgId: o.to_org_id } : undefined);
  const parseRef = (input: OfferRefInput) => {
    const p = OfferRefSchema.safeParse(input);
    return p.success ? ok(p.data) : err(validation(p.error.issues));
  };
  const notAssistant = (actor: Actor): Result<true> => (actor.channel === 'assistant' ? err(appError('FORBIDDEN')) : ok(true as const));

  async function respond(
    actor: Actor, input: OfferRefInput, o: MutateOptions, kind: 'reject' | 'withdraw',
  ): Promise<Result<OfferResult>> {
    // The assistant only drafts; it never sends, rejects or withdraws (Requirement 5.1).
    const na = notAssistant(actor);
    if (!na.ok) return na;
    const parsed = parseRef(input);
    if (!parsed.ok) return parsed;
    const { offerId, expectedVersion } = parsed.value;
    const capability = kind === 'reject' ? 'OFFER_RESPOND' : 'OFFER_WITHDRAW';
    const pre = await offers.get(ctx.pool, offerId);
    return authorized(ctx, actor, capability, resourceOf(pre), () =>
      mutate(actor, `offer.${kind}:${offerId}`, o.idempotencyKey, parsed.value, async (tx) => {
        const row = await offers.getForUpdate(tx, offerId);
        const party = kind === 'reject' ? row?.to_org_id : row?.from_org_id;
        if (!row || party !== actor.orgId) return err(appError('NOT_FOUND'));
        const moved = await moveFrom(tx, row, kind === 'reject' ? 'REJECT' : 'WITHDRAW', nowOf(ctx), expectedVersion);
        if (!moved.ok) return err(moved.error);
        await audit(tx, actor, {
          action: `offer.${kind === 'reject' ? 'rejected' : 'withdrawn'}`,
          entityType: 'offer',
          entityId: row.id,
          entityVersion: moved.value.version,
          detail: { from: row.status, to: moved.value.status },
        });
        const event: OfferEvent = kind === 'reject' ? 'rejected' : 'withdrawn';
        await notifyOrg(tx, kind === 'reject' ? row.from_org_id : row.to_org_id, event, moved.value);
        return ok({ offerId: row.id });
      }),
    );
  }

  return {
    async create(actor, input, o = {}) {
      const na = notAssistant(actor);
      if (!na.ok) return na;
      return authorized(ctx, actor, 'OFFER_SEND', undefined, async () => {
        const p = CreateOfferSchema.safeParse(input);
        if (!p.success) return err(validation(p.error.issues));
        const d = p.data;
        return mutate(actor, 'offer.create', o.idempotencyKey, d, async (tx) => {
          const now = nowOf(ctx);
          let refs: Refs = {
            kind: d.kind,
            listing_id: d.listingId ?? null,
            demand_id: d.demandId ?? null,
            baling_service_id: d.balingServiceId ?? null,
            baling_request_id: d.balingRequestId ?? null,
          };
          let versions: { supplyVersion: number | null; demandVersion: number | null } | null = null;
          if (d.matchId !== undefined) {
            if (refs.listing_id || refs.demand_id || refs.baling_service_id || refs.baling_request_id) {
              return bad('matchId', 'ระบุผลจับคู่หรือรายการอ้างอิงอย่างใดอย่างหนึ่ง');
            }
            const m = await refsFromMatch(tx, d.matchId, d.kind);
            if (!m.ok) return err(m.error);
            const { supplyVersion, demandVersion, ...r } = m.value;
            refs = r;
            versions = { supplyVersion, demandVersion };
          }
          const built = await prepare(tx, actor, refs, {
            qtyKg: d.qtyKg,
            unitPriceThb: d.unitPriceThb ?? null,
            priceUnit: d.priceUnit ?? null,
            transportBy: d.transportBy ?? 'UNKNOWN',
            transportCostThb: d.transportCostThb ?? null,
            readyDate: d.readyDate ?? null,
            expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
            ack: d.ackPendingMaterial ?? false,
          }, now);
          if (!built.ok) return err(built.error);
          // A match computed against older rows is stale: the terms it was based on may have changed.
          const v = built.value;
          if (versions && v.kind === 'PURCHASE') {
            const stale = (want: number | null, have: number | null | undefined) => want !== null && have !== null && have !== undefined && want !== have;
            if (stale(versions.supplyVersion, v.listing_version) || stale(versions.demandVersion, v.demand_version)) {
              return err(appError('STALE_VERSION'));
            }
          }
          const row = await insertOffer(tx, actor, v, { key: o.idempotencyKey });
          await notifyOrg(tx, row.to_org_id, 'created', row);
          return ok({ offerId: row.id });
        });
      });
    },

    async edit(actor, input, o = {}) {
      const na = notAssistant(actor);
      if (!na.ok) return na;
      const p = EditOfferSchema.safeParse(input);
      if (!p.success) return err(validation(p.error.issues));
      const { offerId, expectedVersion, changes } = p.data;
      const pre = await offers.get(ctx.pool, offerId);
      return authorized(ctx, actor, 'OFFER_WITHDRAW', resourceOf(pre), () =>
        mutate(actor, `offer.edit:${offerId}`, o.idempotencyKey, p.data, async (tx) => {
          const now = nowOf(ctx);
          const old = await offers.getForUpdate(tx, offerId);
          if (!old || old.from_org_id !== actor.orgId) return err(appError('NOT_FOUND'));
          // An ACCEPTED offer (or any other non-PENDING one) is never edited (Requirement 11.6).
          const moved = await moveFrom(tx, old, 'WITHDRAW', now, expectedVersion);
          if (!moved.ok) return err(moved.error);
          const price = changes.unitPriceThb !== undefined
            ? { unitPriceThb: changes.unitPriceThb ?? null, priceUnit: changes.priceUnit ?? null }
            : { unitPriceThb: old.unit_price_thb, priceUnit: old.price_unit };
          const built = await prepare(tx, actor, old, {
            qtyKg: changes.qtyKg ?? old.qty_kg,
            ...price,
            transportBy: changes.transportBy ?? old.transport_by,
            transportCostThb: changes.transportCostThb !== undefined ? changes.transportCostThb : old.transport_cost_thb,
            readyDate: changes.readyDate !== undefined ? changes.readyDate : old.ready_date,
            expiresAt: changes.expiresAt ? new Date(changes.expiresAt) : null,
            ack: changes.ackPendingMaterial ?? old.ack_pending_material,
          }, now);
          // A failed rebuild rolls the whole transaction back, so the old offer stays PENDING.
          if (!built.ok) return err(built.error);
          await audit(tx, actor, {
            action: 'offer.withdrawn',
            entityType: 'offer',
            entityId: old.id,
            entityVersion: moved.value.version,
            detail: { from: old.status, to: moved.value.status, reason: 'edited' },
          });
          const row = await insertOffer(tx, actor, built.value, { supersedes: old.id });
          await notifyOrg(tx, row.to_org_id, 'replaced', row);
          return ok({ offerId: row.id, replacedOfferId: old.id });
        }),
      );
    },

    reject: (actor, input, o = {}) => respond(actor, input, o, 'reject'),
    withdraw: (actor, input, o = {}) => respond(actor, input, o, 'withdraw'),

    async accept(actor, input) {
      const na = notAssistant(actor);
      if (!na.ok) return na;
      const pre = await offers.get(ctx.pool, input.offerId);
      return authorized(ctx, actor, 'OFFER_RESPOND', resourceOf(pre), async () => {
        return acceptor(actor, input);
      });
    },

    async get(actor, id) {
      const valid = OfferRefSchema.safeParse({ offerId: id });
      const row = valid.success ? await offers.get(ctx.pool, id) : null;
      return authorized(ctx, actor, 'OFFER_READ', resourceOf(row), async () => (row ? ok(row) : err(appError('NOT_FOUND'))));
    },

    list: (actor, filter = {}) =>
      authorized(ctx, actor, 'OFFER_READ', { orgId: actor.orgId }, async () => {
        const all = await offers.listByOrg(ctx.pool, actor.orgId);
        return ok(
          all.filter(
            (o) =>
              (filter.status === undefined || o.status === filter.status) &&
              (filter.direction === undefined || (filter.direction === 'sent' ? o.from_org_id : o.to_org_id) === actor.orgId),
          ),
        );
      }),

    async expireDue(at, limit = 100) {
      const now = at ?? nowOf(ctx);
      const due = await offers.listExpired(ctx.pool, now, limit);
      let changed = 0;
      for (const candidate of due) {
        const r = await inTransaction<boolean>(ctx, async (tx) => {
          const row = await offers.getForUpdate(tx, candidate.id);
          if (!row || row.status !== 'PENDING' || row.expires_at.getTime() > now.getTime()) return ok(false);
          const t = offerMachine.next(row.status, 'EXPIRE');
          if (!t.ok) return ok(false);
          const updated = await offers.update(tx, row.id, { status: t.state }, { expectedVersion: row.version });
          if (!updated) return ok(false);
          await auditSystem(tx, {
            action: 'offer.expired',
            entityType: 'offer',
            entityId: row.id,
            entityVersion: updated.version,
            detail: { from: row.status, to: updated.status },
          });
          await notifyOrg(tx, row.from_org_id, 'expired', updated);
          await notifyOrg(tx, row.to_org_id, 'expired', updated);
          return ok(true);
        });
        if (r.ok && r.value) changed++;
      }
      return changed;
    },
  };
}
