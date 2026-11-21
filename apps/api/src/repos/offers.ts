import { z } from 'zod';
import { type Db, dateStr, dec, many, ts, uuid } from './db.js';
import { priceUnitBale, transportBy } from './enums.js';
import { type Insertable, table } from './table.js';
export const OfferRow = z.object({
  id: uuid,
  kind: z.enum(['PURCHASE', 'BALING_SERVICE']),
  from_org_id: uuid,
  to_org_id: uuid,
  listing_id: uuid.nullable(),
  demand_id: uuid.nullable(),
  baling_service_id: uuid.nullable(),
  baling_request_id: uuid.nullable(),
  qty_kg: dec,
  unit_price_thb: dec.nullable(),
  price_unit: priceUnitBale.nullable(),
  total_amount_thb: dec.nullable(),
  transport_by: transportBy,
  transport_cost_thb: dec.nullable(),
  ready_date: dateStr.nullable(),
  expires_at: ts,
  listing_version: z.number().int().nullable(),
  demand_version: z.number().int().nullable(),
  ack_pending_material: z.boolean(),
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED']),
  supersedes_offer_id: uuid.nullable(),
  idempotency_key: z.string().nullable(),
  version: z.number().int(),
  is_demo: z.boolean(),
  created_at: ts,
  updated_at: ts,
});
export type Offer = z.infer<typeof OfferRow>;
const t = table('offers', OfferRow, { versioned: true });
export const offers = {
  insert: (db: Db, v: Insertable<Offer, 'kind' | 'from_org_id' | 'to_org_id' | 'qty_kg' | 'transport_by' | 'expires_at' | 'status'>) =>
    t.insert(db, v),
  get: t.get,
  getForUpdate: t.getForUpdate,
  getByIdempotencyKey: async (db: Db, fromOrgId: string, key: string) =>
    (await t.where(db, { from_org_id: fromOrgId, idempotency_key: key }))[0] ?? null,
  update: (db: Db, id: string, patch: Partial<Pick<Offer, 'status' | 'qty_kg' | 'unit_price_thb' | 'total_amount_thb' | 'expires_at'>>, o?: { expectedVersion?: number }) =>
    t.update(db, id, patch, o),
  /** Offers the org sent or received, newest first. */
  listByOrg: (db: Db, orgId: string) =>
    many(db, OfferRow, 'SELECT * FROM offers WHERE from_org_id = $1 OR to_org_id = $1 ORDER BY created_at DESC, id', [orgId]),
  listPendingForListing: (db: Db, listingId: string) =>
    many(db, OfferRow, `SELECT * FROM offers WHERE listing_id = $1 AND status = 'PENDING' ORDER BY created_at, id`, [listingId]),
  listPendingForDemand: (db: Db, demandId: string) =>
    many(db, OfferRow, `SELECT * FROM offers WHERE demand_id = $1 AND status = 'PENDING' ORDER BY created_at, id`, [demandId]),
  /** Pending offers whose expiry has passed at `now`. The caller locks and transitions each one. */
  listExpired: (db: Db, now: Date, limit = 100) =>
    many(db, OfferRow, `SELECT * FROM offers WHERE status = 'PENDING' AND expires_at <= $1 ORDER BY expires_at, id LIMIT $2`, [now, limit]),
};
