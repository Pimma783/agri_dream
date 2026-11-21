import { z } from 'zod';
import { type Db, dec, many, ts, uuid } from './db.js';
import { materialType, publishStatus } from './enums.js';
import { type Insertable, table } from './table.js';
export const BalingRequestRow = z.object({
  id: uuid,
  org_id: uuid,
  material_type: materialType,
  qty_kg: dec,
  requested_mode: z.enum(['ON_SITE', 'AT_FACTORY']),
  province: z.string().nullable(),
  district: z.string().nullable(),
  lat: dec.nullable(),
  lng: dec.nullable(),
  needed_from: ts.nullable(),
  needed_to: ts.nullable(),
  source_draft_id: uuid.nullable(),
  status: publishStatus,
  version: z.number().int(),
  is_demo: z.boolean(),
  created_at: ts,
  updated_at: ts,
});
export type BalingRequest = z.infer<typeof BalingRequestRow>;
const t = table('baling_requests', BalingRequestRow, { versioned: true });
export const balingRequests = {
  insert: (db: Db, v: Insertable<BalingRequest, 'org_id' | 'material_type' | 'qty_kg' | 'requested_mode' | 'status'>) =>
    t.insert(db, v),
  get: t.get,
  getForUpdate: t.getForUpdate,
  getBySourceDraft: async (db: Db, draftId: string) => (await t.where(db, { source_draft_id: draftId }))[0] ?? null,
  update: (db: Db, id: string, patch: Partial<Omit<BalingRequest, 'id' | 'org_id' | 'version' | 'created_at' | 'updated_at'>>, o?: { expectedVersion?: number }) =>
    t.update(db, id, patch, o),
  listByOrg: (db: Db, orgId: string) => t.where(db, { org_id: orgId }, { orderBy: 'created_at DESC' }),
  listPublished: (db: Db) =>
    many(db, BalingRequestRow, `SELECT * FROM baling_requests WHERE status = 'PUBLISHED' ORDER BY created_at`),
};
