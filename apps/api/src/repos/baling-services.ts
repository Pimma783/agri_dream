import { z } from 'zod';
import { type Db, dec, many, ts, uuid } from './db.js';
import { materialType, priceMode, priceUnitBale, publishStatus, transportBy } from './enums.js';
import { type Insertable, table } from './table.js';
export const BalingServiceRow = z.object({
  id: uuid,
  org_id: uuid,
  material_types: z.array(materialType),
  baling_format: z.string().nullable(),
  service_mode: z.enum(['ON_SITE', 'AT_FACTORY', 'BOTH']),
  service_provinces: z.array(z.string()),
  province: z.string().nullable(),
  district: z.string().nullable(),
  lat: dec.nullable(),
  lng: dec.nullable(),
  min_qty_kg: dec.nullable(),
  capacity_kg: dec.nullable(),
  price_mode: priceMode,
  unit_price_thb: dec.nullable(),
  price_unit: priceUnitBale.nullable(),
  transport_by: transportBy,
  available_from: ts.nullable(),
  available_to: ts.nullable(),
  source_draft_id: uuid.nullable(),
  status: publishStatus,
  version: z.number().int(),
  is_demo: z.boolean(),
  created_at: ts,
  updated_at: ts,
});
export type BalingService = z.infer<typeof BalingServiceRow>;
const t = table('baling_services', BalingServiceRow, { versioned: true });
export const balingServices = {
  insert: (db: Db, v: Insertable<BalingService, 'org_id' | 'material_types' | 'service_mode' | 'price_mode' | 'status'>) =>
    t.insert(db, v),
  get: t.get,
  getForUpdate: t.getForUpdate,
  getBySourceDraft: async (db: Db, draftId: string) => (await t.where(db, { source_draft_id: draftId }))[0] ?? null,
  update: (db: Db, id: string, patch: Partial<Omit<BalingService, 'id' | 'org_id' | 'version' | 'created_at' | 'updated_at'>>, o?: { expectedVersion?: number }) =>
    t.update(db, id, patch, o),
  listByOrg: (db: Db, orgId: string) => t.where(db, { org_id: orgId }, { orderBy: 'created_at DESC' }),
  listPublished: (db: Db) =>
    many(db, BalingServiceRow, `SELECT * FROM baling_services WHERE status = 'PUBLISHED' ORDER BY created_at`),
};
