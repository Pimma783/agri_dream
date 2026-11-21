// Layer: services. Media upload, validation and authorized content access (Requirement 8, design "MediaStore").
// Every read or write authorizes first (domain/permissions), then touches the store. Clients receive
// media ids and short-lived signed links, never storage keys. Images are served through the API.
import { type Actor, authorize, type AuthDecision, serviceRegistry } from '../../domain/permissions.js';
import { validateImageBytes, type MediaContentType, type MediaRejection } from '../../domain/media.js';
import { MediaError, type MediaOwnerType, type MediaStore } from '../../adapters/media/port.js';
import { type Db, drafts, listings } from '../../repos/index.js';
import { DbMediaStore } from './db-store.js';
import { signMediaToken, verifyMediaToken } from './signing.js';
export { DbMediaStore } from './db-store.js';
export { signMediaToken, verifyMediaToken } from './signing.js';
/** Managing an image is managing the listing or draft it belongs to: same roles, owner organization only. */
const CAPABILITY = 'LISTING_MANAGE' as const;
serviceRegistry.register('media', CAPABILITY);
export type MediaServiceErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_TOKEN' | MediaRejection;
const STATUS: Record<MediaServiceErrorCode, number> = {
  FORBIDDEN: 403, NOT_FOUND: 404, INVALID_TOKEN: 403, EMPTY: 400, UNSUPPORTED_TYPE: 415, TOO_LARGE: 413,
};
export class MediaServiceError extends Error {
  readonly status: number;
  constructor(public readonly code: MediaServiceErrorCode) {
    super(code);
    this.name = 'MediaServiceError';
    this.status = STATUS[code];
  }
}
export interface MediaServiceDeps {
  pool: Db;
  secret: string;
  ttlSeconds: number;
  now?: () => Date;
  /** Defaults to DbMediaStore on `pool`. Tests and future adapters may pass another store. */
  store?: MediaStore<Db>;
}
export interface UploadInput {
  ownerType: MediaOwnerType;
  ownerId: string;
  bytes: Uint8Array;
}
export interface UploadResult {
  mediaId: string;
  contentType: MediaContentType;
  sizeBytes: number;
  /** True when the same bytes were already stored for this owner (sha256 dedupe). */
  duplicate: boolean;
}
export interface MediaUrl {
  /** Relative API path with a signed token, e.g. /media/:id/content?token=... */
  url: string;
  expiresAt: Date;
}
function deny(d: AuthDecision, missing: boolean): never {
  if (!d.allowed) throw new MediaServiceError(d.code);
  if (missing) throw new MediaServiceError('NOT_FOUND');
  throw new MediaServiceError('FORBIDDEN');
}
export function createMediaService(deps: MediaServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const store: MediaStore<Db> = deps.store ?? new DbMediaStore(deps.pool);
  async function ownerOrgId(ownerType: MediaOwnerType, ownerId: string): Promise<string | null> {
    const row = ownerType === 'DRAFT' ? await drafts.get(deps.pool, ownerId) : await listings.get(deps.pool, ownerId);
    return row?.org_id ?? null;
  }
  /** Authorizes `actor` against an organization; throws 403/404. */
  function check(actor: Actor, orgId: string | null): void {
    const d = authorize(actor, CAPABILITY, orgId === null ? undefined : { orgId });
    if (!d.allowed || orgId === null) deny(d, orgId === null);
  }
  async function authorizedMeta(actor: Actor, mediaId: string) {
    const meta = await store.metadata(mediaId);
    check(actor, meta?.orgId ?? null);
    return meta!;
  }
  return {
    kind: store.kind,
    /** Pure check of size and magic bytes; throws nothing. */
    validate: (bytes: Uint8Array) => validateImageBytes(bytes),
    async upload(actor: Actor, input: UploadInput): Promise<UploadResult> {
      check(actor, await ownerOrgId(input.ownerType, input.ownerId));
      try {
        const { meta, duplicate } = await store.put({
          orgId: actor.orgId, ownerType: input.ownerType, ownerId: input.ownerId, createdBy: actor.userId, bytes: input.bytes,
        });
        return { mediaId: meta.id, contentType: meta.contentType, sizeBytes: meta.sizeBytes, duplicate };
      } catch (err) {
        if (err instanceof MediaError) throw new MediaServiceError(err.code);
        throw err;
      }
    },
    /** Authorizes, then issues a short-lived signed link served by the API. */
    async getMediaUrl(actor: Actor, mediaId: string): Promise<MediaUrl> {
      const meta = await authorizedMeta(actor, mediaId);
      const expiresAt = new Date(now().getTime() + deps.ttlSeconds * 1000);
      const token = signMediaToken(deps.secret, meta.id, expiresAt);
      return { url: `/media/${meta.id}/content?token=${token}`, expiresAt };
    },
    /**
     * Authorizes, then returns the bytes (direct authorized streaming). When `token` is given it must be a
     * valid, unexpired link for this media id; the actor is still authorized, so a leaked link alone is useless.
     */
    async getContent(actor: Actor, mediaId: string, token?: string) {
      if (token !== undefined) {
        const t = verifyMediaToken(deps.secret, token, now());
        if (!t.ok || t.mediaId !== mediaId) throw new MediaServiceError('INVALID_TOKEN');
      }
      const meta = await authorizedMeta(actor, mediaId);
      const content = await store.get(meta.id);
      if (!content) throw new MediaServiceError('NOT_FOUND');
      return { bytes: content.bytes, contentType: content.contentType, sizeBytes: meta.sizeBytes };
    },
    async delete(actor: Actor, mediaId: string): Promise<void> {
      const meta = await authorizedMeta(actor, mediaId);
      await store.delete(meta.id);
    },
  };
}
export type MediaService = ReturnType<typeof createMediaService>;
