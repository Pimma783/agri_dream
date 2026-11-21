import { createHash } from 'node:crypto';
import { validateImageBytes } from '../../domain/media.js';
import { type Db, media, type Media } from '../../repos/index.js';
import { MediaError, type MediaMeta, type MediaPutInput, type MediaPutResult, type MediaStore } from '../../adapters/media/port.js';
const toMeta = (m: Media): MediaMeta => ({
  id: m.id, orgId: m.org_id, ownerType: m.owner_type, ownerId: m.owner_id, contentType: m.content_type,
  sizeBytes: m.size_bytes, sha256: m.sha256, createdAt: m.created_at,
});
/**
 * Default media store: bytes live in media.content (storage_kind 'db'). Kind 'real'.
 * It does no authorization; services/media/index.ts authorizes before calling it.
 * It lives under services/ because it needs the repo, which adapters/ may not import.
 */
export class DbMediaStore implements MediaStore<Db> {
  readonly kind = 'real' as const;
  readonly storageKind = 'db' as const;
  constructor(private readonly pool: Db) {}
  async put(input: MediaPutInput, ctx?: Db): Promise<MediaPutResult> {
    const db = ctx ?? this.pool;
    const v = validateImageBytes(input.bytes);
    if (!v.ok) throw new MediaError(v.reason);
    const content = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const existing = await media.getByOwnerHash(db, input.ownerType, input.ownerId, sha256);
    if (existing) return { meta: toMeta(existing), duplicate: true };
    try {
      const row = await media.insertDb(db, {
        org_id: input.orgId, owner_type: input.ownerType, owner_id: input.ownerId, content_type: v.contentType,
        size_bytes: v.sizeBytes, sha256, created_by: input.createdBy, is_demo: input.isDemo ?? false, content,
      });
      return { meta: toMeta(row), duplicate: false };
    } catch (err) {
      // Lost a race with a concurrent identical upload: UNIQUE(owner_type, owner_id, sha256).
      // Inside a transaction the failed statement aborts it, so callers in a tx should not hit this path.
      if ((err as { code?: string }).code === '23505') {
        const again = await media.getByOwnerHash(db, input.ownerType, input.ownerId, sha256);
        if (again) return { meta: toMeta(again), duplicate: true };
      }
      throw err;
    }
  }
  async metadata(id: string, ctx?: Db): Promise<MediaMeta | null> {
    const row = await media.get(ctx ?? this.pool, id);
    return row ? toMeta(row) : null;
  }
  async get(id: string, ctx?: Db) {
    const row = await media.getContent(ctx ?? this.pool, id);
    return row ? { bytes: row.content, contentType: row.content_type } : null;
  }
  async delete(id: string, ctx?: Db): Promise<boolean> {
    return (await media.delete(ctx ?? this.pool, id)) > 0;
  }
}
