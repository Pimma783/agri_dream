// Layer: services. Pure visibility mapper for GET /matches (Requirements 9.10, 14.9, 17.5).
// The output is built from an allowlist: only fields named here can leave the service. Nothing is copied
// by spreading a row, so a new column or an unexpected property can never leak. The counterparty is shown
// at province level only: no coordinates, district, owner ids, contact data or farmer identity.
import { z } from 'zod';
import { renderFlagTh, renderReasonTh, WEIGHTS_DISCLAIMER_TH } from '../../matching/index.js';
import type { Flag, Reason } from '../../matching/types.js';
import type { Match } from '../../repos/matches.js';
import type { BalingRequest, BalingService, Demand, Listing } from '../../repos/index.js';

export const SCORE_LABEL_TH = 'ประมาณการ';
export const WEIGHTS_LABEL_TH = 'น้ำหนักคะแนนเริ่มต้น';
export const DISTANCE_LABEL_TH = 'ระยะเส้นตรง (ไม่ใช่ระยะขับรถ)';

export type MatchEntityKind = 'LISTING' | 'DEMAND' | 'BALING_REQUEST' | 'BALING_SERVICE';
export type OwnSide = 'supply' | 'demand';

/** The counterparty's source row plus the minimum about its organization. */
export type CounterpartySource =
  | { type: 'LISTING'; row: Listing; org: { kind: string; name: string } }
  | { type: 'DEMAND'; row: Demand; org: { kind: string; name: string } }
  | { type: 'BALING_REQUEST'; row: BalingRequest; org: { kind: string; name: string } }
  | { type: 'BALING_SERVICE'; row: BalingService; org: { kind: string; name: string } };

export type MatchRowForView = Pick<
  Match,
  'id' | 'route' | 'supply_id' | 'demand_id' | 'rule_version' | 'score' | 'weight_coverage' | 'components' | 'flags' |
  'reasons' | 'distance_km' | 'tier' | 'is_demo' | 'computed_at'
>;

export interface MatchView {
  id: string;
  route: number;
  own_side: OwnSide;
  own_entity_id: string;
  tier: 0 | 1;
  score: string;
  score_label_th: string;
  weights_label_th: string;
  weights_disclaimer_th: string;
  weight_coverage: string | null;
  components: Record<string, { value: string | null; weight: string }>;
  missing_components: string[];
  flags: Array<{ code: Flag['code']; field?: string; label_th: string }>;
  reasons: Array<{ code: string; params: Record<string, string | number | null>; text_th: string }>;
  distance: { km: string; kind: 'straight_line'; label_th: string } | null;
  rule_version: string;
  is_demo: boolean;
  computed_at: string;
  counterparty: {
    entity_type: MatchEntityKind;
    entity_id: string;
    /** Business name, only for balers and factories. Never for a farmer. */
    display_name: string | null;
    org_kind: string;
    province: string | null;
    published: Record<string, unknown>;
  };
}

const Component = z.object({ value: z.string().nullable(), weight: z.string() });
const Components = z.record(z.string(), Component);
const FlagSchema = z.union([
  z.object({ code: z.literal('NEEDS_CONFIRMATION'), field: z.string() }),
  z.object({ code: z.literal('INCOMPLETE') }),
  z.object({ code: z.literal('PRICE_MISMATCH') }),
  z.object({ code: z.literal('DISTANCE_UNVERIFIED') }),
]);
const ReasonSchema = z.object({
  code: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
});

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Published (marketplace-facing) fields of the counterparty's entity. */
function publishedFields(src: CounterpartySource): { province: string | null; fields: Record<string, unknown> } {
  switch (src.type) {
    case 'LISTING': {
      const r = src.row;
      return {
        province: r.province,
        fields: {
          kind: r.kind, material_type: r.material_type, material_form: r.material_form, remaining_qty_kg: r.remaining_qty_kg,
          price_mode: r.price_mode, unit_price_thb: r.unit_price_thb, price_unit: r.price_unit,
          available_from: iso(r.available_from), available_to: iso(r.available_to), transport_by: r.transport_by,
          pending_material: r.pending_material, expected_ready_at: iso(r.expected_ready_at),
        },
      };
    }
    case 'DEMAND': {
      const r = src.row;
      return {
        province: r.province,
        fields: {
          accepted_materials: r.accepted_materials, accepted_forms: r.accepted_forms, remaining_qty_kg: r.remaining_qty_kg,
          min_lot_kg: r.min_lot_kg, price_mode: r.price_mode, max_unit_price_thb: r.max_unit_price_thb, price_unit: r.price_unit,
          radius_km: r.radius_km, accepted_provinces: r.accepted_provinces, window_from: iso(r.window_from),
          window_to: iso(r.window_to), transport_by: r.transport_by,
        },
      };
    }
    case 'BALING_REQUEST': {
      const r = src.row;
      return {
        province: r.province,
        fields: {
          material_type: r.material_type, qty_kg: r.qty_kg, requested_mode: r.requested_mode,
          needed_from: iso(r.needed_from), needed_to: iso(r.needed_to),
        },
      };
    }
    case 'BALING_SERVICE': {
      const r = src.row;
      return {
        province: r.province,
        fields: {
          material_types: r.material_types, baling_format: r.baling_format, service_mode: r.service_mode,
          service_provinces: r.service_provinces, min_qty_kg: r.min_qty_kg, capacity_kg: r.capacity_kg,
          price_mode: r.price_mode, unit_price_thb: r.unit_price_thb, price_unit: r.price_unit,
          available_from: iso(r.available_from), available_to: iso(r.available_to), transport_by: r.transport_by,
        },
      };
    }
  }
}

export function toMatchView(row: MatchRowForView, ownSide: OwnSide, cp: CounterpartySource): MatchView {
  const components = Components.safeParse(row.components);
  const comps = components.success ? components.data : {};
  const flags = z.array(FlagSchema).safeParse(row.flags);
  const reasons = z.array(ReasonSchema).safeParse(row.reasons);
  const pub = publishedFields(cp);
  return {
    id: row.id,
    route: row.route,
    own_side: ownSide,
    own_entity_id: ownSide === 'supply' ? row.supply_id : row.demand_id,
    tier: row.tier === 0 ? 0 : 1,
    score: row.score,
    score_label_th: SCORE_LABEL_TH,
    weights_label_th: WEIGHTS_LABEL_TH,
    weights_disclaimer_th: WEIGHTS_DISCLAIMER_TH,
    weight_coverage: row.weight_coverage,
    components: Object.fromEntries(Object.entries(comps).map(([k, v]) => [k, { value: v.value, weight: v.weight }])),
    missing_components: Object.entries(comps).filter(([, v]) => v.value === null).map(([k]) => k),
    flags: (flags.success ? flags.data : []).map((f) => ({
      code: f.code,
      ...(f.code === 'NEEDS_CONFIRMATION' ? { field: f.field } : {}),
      label_th: renderFlagTh(f as Flag),
    })),
    reasons: (reasons.success ? reasons.data : []).map((r) => ({
      code: r.code,
      params: { ...r.params },
      text_th: renderReasonTh(r as Reason),
    })),
    distance: row.distance_km === null ? null : { km: row.distance_km, kind: 'straight_line', label_th: DISTANCE_LABEL_TH },
    rule_version: row.rule_version,
    is_demo: row.is_demo,
    computed_at: row.computed_at.toISOString(),
    counterparty: {
      entity_type: cp.type,
      entity_id: cp.row.id,
      display_name: cp.org.kind === 'FARMER' ? null : cp.org.name,
      org_kind: cp.org.kind,
      province: pub.province,
      published: pub.fields,
    },
  };
}
