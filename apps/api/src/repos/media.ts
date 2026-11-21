import { z } from 'zod';
import { type Db, exec, maybe, ts, uuid } from './db.js';
import { type Insertable, table } from './table.js';
export const MediaRow = z.object({
  id: uuid,
  org_id: uuid,
  owner_type: z.enum(['DRAFT', 'LISTING']),
  owner_id: uuid,
  storage_kind: z.enum(['db', 's3']),
  storage_key: z.string().nullable(),
  content_type: z.enum(['image/jpeg', 'image/png']),
  size_bytes: z.number().int(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  created_by: uuid.nullable(),
  is_demo: z.boolean(),
  created_at: ts,
});
export type Media = z.infer<typeof MediaRow>;
const COLUMNS = [
  'id', 'org_id', 'owner_type', 'owner_id', 'storage_kind', 'storage_key', 'content_type',
  'size_bytes', 'sha256', 'created_by', 'is_demo', 'created_at',
] as const;
// Metadata reads never select the bytea content; use getContent for the bytes.
const t = table('media', MediaRow, { columns: COLUMNS });
export const media = {
  /** Stores the bytes in the `content` column (storage_kind 'db'). */
  insertDb: (db: Db, v: Insertable<Media, 'org_id' | 'owner_type' | 'owner_id' | 'content_type' | 'size_bytes' | 'sha256'> & { content: Buffer }) =>
    t.insert(db, { ...v, storage_kind: 'db' }),
  get: t.get,
  listByOwner: (db: Db, ownerType: Media['owner_type'], ownerId: string) =>
    t.where(db, { owner_type: ownerType, owner_id: ownerId }, { orderBy: 'created_at' }),
  getByOwnerHash: async (db: Db, ownerType: Media['owner_type'], ownerId: string, sha256: string) =>
    (await t.where(db, { owner_type: ownerType, owner_id: ownerId, sha256 }))[0] ?? null,
  /** Raw bytes plus content type, or null when missing or not stored in the database. */
  getContent: (db: Db, id: string) =>
    maybe(
      db,
      z.object({ content: z.instanceof(Buffer), content_type: z.enum(['image/jpeg', 'image/png']) }),
      'SELECT content, content_type FROM media WHERE id = $1 AND content IS NOT NULL',
      [id],
    ),
  delete: (db: Db, id: string) => exec(db, 'DELETE FROM media WHERE id = $1', [id]),
};
