// Creates the published entity (listing, demand, baling service or request) from a confirmed draft.
// `source_draft_id` is UNIQUE on every target table, so even a bypassed lock could not make two rows.
import {
  type Db, type Draft, balingRequests, balingServices, demands, listings,
} from '../../repos/index.js';
import { CANONICAL, type DraftKind } from './schemas.js';

export type PublishedEntityType = NonNullable<Draft['published_entity_type']>;

/** Drop undefined values so the column default (or NULL) applies. */
const clean = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };

const date = (s: string | undefined): Date | undefined => (s === undefined ? undefined : new Date(s));

/** `data` has already passed completeness(), so these parses only narrow the type. */
export async function createEntityFromDraft(
  db: Db,
  draft: Draft,
  kind: DraftKind,
  data: Record<string, unknown>,
): Promise<{ type: PublishedEntityType; id: string }> {
  const common = { org_id: draft.org_id, source_draft_id: draft.id, status: 'PUBLISHED' as const, is_demo: draft.is_demo };
  switch (kind) {
    case 'SALE_LISTING':
    case 'RESALE_LISTING': {
      const resale = kind === 'RESALE_LISTING' ? CANONICAL.RESALE_LISTING.parse(data) : null;
      const d = resale ?? CANONICAL.SALE_LISTING.parse(data);
      const row = await listings.insert(db, clean({
        ...common,
        kind: kind === 'SALE_LISTING' ? 'SALE' : 'RESALE',
        material_type: d.material_type,
        material_form: d.material_form,
        total_qty_kg: d.qty_kg,
        remaining_qty_kg: d.qty_kg,
        price_mode: d.price_mode,
        // NEGOTIABLE leaves both undefined, which stores NULL (never 0; Requirement 6.5).
        unit_price_thb: d.price_mode === 'FIXED' ? d.unit_price_thb : undefined,
        price_unit: d.price_mode === 'FIXED' ? d.price_unit : undefined,
        province: d.province,
        district: d.district,
        lat: d.lat,
        lng: d.lng,
        available_from: date(d.available_from),
        available_to: date(d.available_to),
        transport_by: d.transport_by,
        pending_material: resale?.pending_material,
        expected_ready_at: date(resale?.expected_ready_at),
        source_agreement_id: kind === 'RESALE_LISTING' ? draft.source_agreement_id : undefined,
      }));
      return { type: 'LISTING', id: row.id };
    }
    case 'PURCHASE_DEMAND': {
      const d = CANONICAL.PURCHASE_DEMAND.parse(data);
      const row = await demands.insert(db, clean({
        ...common,
        accepted_materials: d.accepted_materials,
        accepted_forms: d.accepted_forms,
        target_qty_kg: d.target_qty_kg,
        remaining_qty_kg: d.target_qty_kg,
        min_lot_kg: d.min_lot_kg,
        price_mode: d.price_mode,
        max_unit_price_thb: d.price_mode === 'FIXED' ? d.max_unit_price_thb : undefined,
        price_unit: d.price_mode === 'FIXED' ? d.price_unit : undefined,
        province: d.province,
        district: d.district,
        lat: d.lat,
        lng: d.lng,
        radius_km: d.radius_km,
        accepted_provinces: d.accepted_provinces,
        window_from: date(d.window_from),
        window_to: date(d.window_to),
        quality: d.quality ?? {},
        transport_by: d.transport_by,
        accepts_pending_material: d.accepts_pending_material,
      }));
      return { type: 'DEMAND', id: row.id };
    }
    case 'BALING_SERVICE': {
      const d = CANONICAL.BALING_SERVICE.parse(data);
      const row = await balingServices.insert(db, clean({
        ...common,
        material_types: d.material_types,
        baling_format: d.baling_format,
        service_mode: d.service_mode,
        service_provinces: d.service_provinces,
        province: d.province,
        district: d.district,
        lat: d.lat,
        lng: d.lng,
        min_qty_kg: d.min_qty_kg,
        capacity_kg: d.capacity_kg,
        price_mode: d.price_mode,
        unit_price_thb: d.price_mode === 'FIXED' ? d.unit_price_thb : undefined,
        price_unit: d.price_mode === 'FIXED' ? d.price_unit : undefined,
        transport_by: d.transport_by,
        available_from: date(d.available_from),
        available_to: date(d.available_to),
      }));
      return { type: 'BALING_SERVICE', id: row.id };
    }
    case 'BALING_REQUEST': {
      const d = CANONICAL.BALING_REQUEST.parse(data);
      const row = await balingRequests.insert(db, clean({
        ...common,
        material_type: d.material_type,
        qty_kg: d.qty_kg,
        requested_mode: d.requested_mode,
        province: d.province,
        district: d.district,
        lat: d.lat,
        lng: d.lng,
        needed_from: date(d.needed_from),
        needed_to: date(d.needed_to),
      }));
      return { type: 'BALING_REQUEST', id: row.id };
    }
  }
}
