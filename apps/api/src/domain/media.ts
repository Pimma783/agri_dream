// Pure image rules (Requirement 8): magic-byte sniffing and the size limit. No I/O.
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024; // 5 MB, same as the media.size_bytes CHECK
export type MediaContentType = 'image/jpeg' | 'image/png';
export type MediaRejection = 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const startsWith = (b: Uint8Array, sig: readonly number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
/** Content type from the first bytes only. A client-declared type or file name is never trusted. */
export function sniffImageType(bytes: Uint8Array): MediaContentType | null {
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  return null;
}
export type MediaValidation =
  | { ok: true; contentType: MediaContentType; sizeBytes: number }
  | { ok: false; reason: MediaRejection };
export function validateImageBytes(bytes: Uint8Array, maxBytes: number = MAX_MEDIA_BYTES): MediaValidation {
  if (bytes.length === 0) return { ok: false, reason: 'EMPTY' };
  if (bytes.length > Math.min(maxBytes, MAX_MEDIA_BYTES)) return { ok: false, reason: 'TOO_LARGE' };
  const contentType = sniffImageType(bytes);
  if (contentType === null) return { ok: false, reason: 'UNSUPPORTED_TYPE' };
  return { ok: true, contentType, sizeBytes: bytes.length };
}
