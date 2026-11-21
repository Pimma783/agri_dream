import { z } from 'zod';
import { type Db, dec, many, ts, uuid } from './db.js';
import { priceUnitBale } from './enums.js';
import { type Insertable, table } from './table.js';
export const AgreementRow = z.object({
  id: uuid,
  kind: z.enum(['PURCHASE', 'BALING_SERVICE']),
  offer_id: uuid,
  seller_org_id: uuid,
  buyer_org_id: uuid,
  listing_id: uuid.nullable(),
  demand_id: uuid.nullable(),
  baling_service_id: uuid.nullable(),
  baling_request_id: uuid.nullable(),
  qty_kg: dec,
  unit_price_thb: dec.nullable(),
  price_unit: priceUnitBale.nullable(),
  total_amount_thb: dec.nullable(),
  status: z.enum(['PURCHASE_CONFIRMED', 'SERVICE_CONFIRMED', 'NEEDS_REVIEW', 'CANCELLED']),
  resale_reserved_kg: dec,
  source_agreement_id: uuid.nullable(),
  version: z.number().int(),
  is_demo: z.boolean(),
  confirmed_at: ts,
});
export type Agreement = z.infer<typeof AgreementRow>;
// agreements has `version` but no `updated_at`.
const t = table('agreements', AgreementRow, { versionOnly: true });
export const agreements = {
  insert: (db: Db, v: Insertable<Agreement, 'kind' | 'offer_id' | 'seller_org_id' | 'buyer_org_id' | 'qty_kg' | 'status'>) =>
    t.insert(db, v),
  /** Idempotent accept: returns null when the offer already has an agreement. */
  insertIfAbsent: (db: Db, v: Insertable<Agreement, 'kind' | 'offer_id' | 'seller_org_id' | 'buyer_org_id' | 'qty_kg' | 'status'>) =>
    t.insertIfAbsent(db, v, 'offer_id'),
  get: t.get,
  getForUpdate: t.getForUpdate,
  getByOffer: async (db: Db, offerId: string) => (await t.where(db, { offer_id: offerId }))[0] ?? null,
  update: (db: Db, id: string, patch: Partial<Pick<Agreement, 'status' | 'resale_reserved_kg'>>, o?: { expectedVersion?: number }) =>
    t.update(db, id, patch, o),
  listByOrg: (db: Db, orgId: string) =>
    many(db, AgreementRow, 'SELECT * FROM agreements WHERE seller_org_id = $1 OR buyer_org_id = $1 ORDER BY confirmed_at DESC, id', [orgId]),
};
