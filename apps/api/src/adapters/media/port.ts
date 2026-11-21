// MediaStore port (design.md "MediaStore"). Pure types: adapters may not import repos or services,
// so the Postgres-backed implementation lives in services/media/db-store.ts and receives the repo.
//
// Storage kinds: 'db' (bytea in the media table, the default and the only implemented one) and
// 's3' (RESERVED: the schema allows it, no adapter exists, and nothing selects it).
export type MediaStorageKind = 'db' | 's3';
export type MediaOwnerType = 'DRAFT' | 'LISTING';
export type MediaContentTypeName = 'image/jpeg' | 'image/png';
export interface MediaPutInput {
  orgId: string;
  ownerType: MediaOwnerType;
  ownerId: string;
  createdBy: string | null;
  bytes: Uint8Array;
  /** Declared type is ignored; the adapter sniffs the bytes. No file name is accepted or stored. */
  isDemo?: boolean;
}
/** Metadata safe to hand to services. It never contains bytes or a storage key. */
export interface MediaMeta {
  id: string;
  orgId: string;
  ownerType: MediaOwnerType;
  ownerId: string;
  contentType: MediaContentTypeName;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
}
export type MediaPutResult = { meta: MediaMeta; duplicate: boolean };
export type MediaErrorCode = 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE';
export class MediaError extends Error {
  constructor(public readonly code: MediaErrorCode) {
    super(`media rejected: ${code}`);
    this.name = 'MediaError';
  }
}
/** `Ctx` is whatever the adapter needs to join a caller's transaction (a Db for DbMediaStore). */
export interface MediaStore<Ctx = undefined> {
  readonly kind: 'real' | 'mock';
  readonly storageKind: MediaStorageKind;
  /** Validates, hashes and stores. The same bytes for the same owner return the existing row (duplicate: true). */
  put(input: MediaPutInput, ctx?: Ctx): Promise<MediaPutResult>;
  metadata(id: string, ctx?: Ctx): Promise<MediaMeta | null>;
  get(id: string, ctx?: Ctx): Promise<{ bytes: Buffer; contentType: MediaContentTypeName } | null>;
  delete(id: string, ctx?: Ctx): Promise<boolean>;
}
