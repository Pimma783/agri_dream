import { z } from 'zod';
import { type Db, dec, many, ts, uuid } from './db.js';
import { materialForm, materialType, priceMode, priceUnit, publishStatus, transportBy } from './enums.js';
import { type Insertable, table } from './table.js';
export const ListingRow = z.object({
  id: uuid,
  org_id: uuid,
  kind: z.enum(['SALE', 'RESALE']),
  material_type: materialType,
  material_form: materialForm.nullable(),
  total_qty_kg: dec,
  committed_qty_kg: dec,
  remaining_qty_kg: dec,
  price_mode: priceMode,
  unit_price_thb: dec.nullable(),
  price_unit: priceUnit.nullable(),
  province: z.string().nullable(),
  district: z.string().nullable(),
  lat: dec.nullable(),
  lng: dec.nullable(),
  available_from: ts.nullable(),
  available_to: ts.nullable(),
  transport_by: transportBy,
  pending_material: z.boolean(),
  expected_ready_at: ts.nullable(),
  source_agreement_id: uuid.nullable(),
  source_draft_id: uuid.nullable(),
  status: publishStatus,
  version: z.number().int(),
  is_demo: z.boolean(),
  created_at: ts,
  updated_at: ts,
});
export type Listing = z.infer<typeof ListingRow>;
const t = table('material_listings', ListingRow, { versioned: true });
export const listings = {
  insert: (db: Db, v: Insertable<Listing, 'org_id' | 'kind' | 'material_type' | 'total_qty_kg' | 'remaining_qty_kg' | 'price_mode' | 'status'>) =>
    t.insert(db, v),
  get: t.get,
  getForUpdate: t.getForUpdate,
  getBySourceDraft: async (db: Db, draftId: string) => (await t.where(db, { source_draft_id: draftId }))[0] ?? null,
  update: (db: Db, id: string, patch: Partial<Omit<Listing, 'id' | 'org_id' | 'version' | 'created_at' | 'updated_at'>>, o?: { expectedVersion?: number }) =>
    t.update(db, id, patch, o),
  listByOrg: (db: Db, orgId: string) => t.where(db, { org_id: orgId }, { orderBy: 'created_at DESC' }),
  /** Candidate supply for matching: published listings, optionally one material. Filtering rules live in matching/. */
  listPublished: (db: Db, materialTypeFilter?: Listing['material_type']) =>
    many(
      db,
      ListingRow,
      `SELECT * FROM material_listings WHERE status = 'PUBLISHED' AND ($1::text IS NULL OR material_type = $1) ORDER BY created_at`,
      [materialTypeFilter ?? null],
    ),
};
