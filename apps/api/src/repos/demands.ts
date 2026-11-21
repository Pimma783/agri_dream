import { z } from 'zod';
import { type Db, dec, json, many, ts, uuid } from './db.js';
import { materialForm, materialType, priceMode, priceUnit, publishStatus, transportBy } from './enums.js';
import { type Insertable, table } from './table.js';
export const DemandRow = z.object({
  id: uuid,
  org_id: uuid,
  accepted_materials: z.array(materialType),
  accepted_forms: z.array(materialForm),
  target_qty_kg: dec,
  committed_qty_kg: dec,
  remaining_qty_kg: dec,
  min_lot_kg: dec.nullable(),
  price_mode: priceMode,
  max_unit_price_thb: dec.nullable(),
  price_unit: priceUnit.nullable(),
  province: z.string().nullable(),
  district: z.string().nullable(),
  lat: dec.nullable(),
  lng: dec.nullable(),
  radius_km: dec.nullable(),
  accepted_provinces: z.array(z.string()),
  window_from: ts.nullable(),
  window_to: ts.nullable(),
  quality: json,
  transport_by: transportBy,
  accepts_pending_material: z.boolean(),
  source_draft_id: uuid.nullable(),
  status: publishStatus,
  version: z.number().int(),
  is_demo: z.boolean(),
  created_at: ts,
  updated_at: ts,
});
export type Demand = z.infer<typeof DemandRow>;
const t = table('purchase_demands', DemandRow, { json: ['quality'], versioned: true });
export const demands = {
  insert: (db: Db, v: Insertable<Demand, 'org_id' | 'accepted_materials' | 'target_qty_kg' | 'remaining_qty_kg' | 'price_mode' | 'status'>) =>
    t.insert(db, v),
  get: t.get,
  getForUpdate: t.getForUpdate,
  getBySourceDraft: async (db: Db, draftId: string) => (await t.where(db, { source_draft_id: draftId }))[0] ?? null,
  update: (db: Db, id: string, patch: Partial<Omit<Demand, 'id' | 'org_id' | 'version' | 'created_at' | 'updated_at'>>, o?: { expectedVersion?: number }) =>
    t.update(db, id, patch, o),
  listByOrg: (db: Db, orgId: string) => t.where(db, { org_id: orgId }, { orderBy: 'created_at DESC' }),
  listPublished: (db: Db) =>
    many(db, DemandRow, `SELECT * FROM purchase_demands WHERE status = 'PUBLISHED' ORDER BY created_at`),
};
