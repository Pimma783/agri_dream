import { z } from 'zod';
import { type Db, json, ts, uuid, many, maybe } from './db.js';
import { type Insertable, table } from './table.js';
export const DraftRow = z.object({
  id: uuid,
  org_id: uuid,
  created_by: uuid.nullable(),
  kind: z.enum(['SALE_LISTING', 'RESALE_LISTING', 'PURCHASE_DEMAND', 'BALING_SERVICE', 'BALING_REQUEST']),
  data: json,
  status: z.enum(['DRAFT', 'AWAITING_REVIEW', 'PUBLISHED', 'CANCELLED']),
  published_entity_type: z.enum(['LISTING', 'DEMAND', 'BALING_SERVICE', 'BALING_REQUEST']).nullable(),
  published_entity_id: uuid.nullable(),
  source_agreement_id: uuid.nullable(),
  version: z.number().int(),
  is_demo: z.boolean(),
  created_at: ts,
  updated_at: ts,
});
export type Draft = z.infer<typeof DraftRow>;
const t = table('drafts', DraftRow, { json: ['data'], versioned: true });
export const drafts = {
  insert: (db: Db, v: Insertable<Draft, 'org_id' | 'kind'>) => t.insert(db, v),
  get: t.get,
  getForUpdate: t.getForUpdate,
  /** Optimistic update: pass `expectedVersion` to fail (null) when someone else changed the row. */
  update: (db: Db, id: string, patch: Partial<Omit<Draft, 'id' | 'org_id' | 'version' | 'created_at' | 'updated_at'>>, o?: { expectedVersion?: number }) =>
    t.update(db, id, patch, o),
  /**
   * AWAITING_REVIEW -> PUBLISHED at exactly `expectedVersion`. The version is NOT bumped, so the same
   * (draft, version) confirmation can be replayed and still names the published entity. Null when the
   * row is not awaiting review at that version.
   */
  markPublished: (db: Db, id: string, expectedVersion: number, entityType: NonNullable<Draft['published_entity_type']>, entityId: string) =>
    maybe(
      db,
      DraftRow,
      `UPDATE drafts SET status = 'PUBLISHED', published_entity_type = $3, published_entity_id = $4, updated_at = now()
       WHERE id = $1 AND version = $2 AND status = 'AWAITING_REVIEW' RETURNING *`,
      [id, expectedVersion, entityType, entityId],
    ),
  listByOrg: (db: Db, orgId: string) => t.where(db, { org_id: orgId }, { orderBy: 'created_at DESC' }),
  listByOrgStatus: (db: Db, orgId: string, status: Draft['status']) =>
    many(db, DraftRow, 'SELECT * FROM drafts WHERE org_id = $1 AND status = $2 ORDER BY created_at DESC', [orgId, status]),
};
