import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MAX_MEDIA_BYTES, sniffImageType, validateImageBytes } from '../src/domain/media.js';
import { signMediaToken, verifyMediaToken } from '../src/services/media/signing.js';
const png = (n = 20) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(n).fill(7)]);
const jpg = (n = 20) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(n).fill(7)]);
describe('image validation', () => {
  it('sniffs JPEG and PNG from magic bytes', () => {
    expect(sniffImageType(png())).toBe('image/png');
    expect(sniffImageType(jpg())).toBe('image/jpeg');
  });
  it('rejects wrong types: GIF, PDF, HTML, text, truncated signatures', () => {
    for (const b of [Buffer.from('GIF89a......'), Buffer.from('%PDF-1.7'), Buffer.from('<html></html>'), Uint8Array.of(0xff, 0xd8), Uint8Array.of(0x89, 0x50)]) {
      expect(validateImageBytes(b)).toEqual({ ok: false, reason: 'UNSUPPORTED_TYPE' });
    }
  });
  it('rejects empty and oversize; accepts exactly 5 MB', () => {
    expect(validateImageBytes(new Uint8Array(0))).toEqual({ ok: false, reason: 'EMPTY' });
    const at = new Uint8Array(MAX_MEDIA_BYTES); at.set(jpg(0));
    expect(validateImageBytes(at)).toMatchObject({ ok: true, contentType: 'image/jpeg', sizeBytes: MAX_MEDIA_BYTES });
    const over = new Uint8Array(MAX_MEDIA_BYTES + 1); over.set(jpg(0));
    expect(validateImageBytes(over)).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });
  it('a caller cannot raise the limit above 5 MB', () => {
    const over = new Uint8Array(MAX_MEDIA_BYTES + 1); over.set(png(0));
    expect(validateImageBytes(over, 10 * MAX_MEDIA_BYTES)).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });
  it('property: result agrees with the signature and size rules', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 64 }), (b) => {
      const v = validateImageBytes(b);
      if (b.length === 0) return !v.ok && v.reason === 'EMPTY';
      return v.ok === (sniffImageType(b) !== null);
    }));
  });
});
describe('signed media tokens', () => {
  const secret = 'unit-test-secret';
  const id = '6f1b0c52-5f0e-4f3e-9d4e-0a0a0a0a0a0a';
  const t0 = new Date('2026-01-01T00:00:00Z');
  const exp = new Date(t0.getTime() + 300_000);
  it('verifies before expiry and rejects at expiry', () => {
    const tok = signMediaToken(secret, id, exp);
    expect(verifyMediaToken(secret, tok, t0)).toEqual({ ok: true, mediaId: id });
    expect(verifyMediaToken(secret, tok, exp)).toEqual({ ok: false, reason: 'EXPIRED' });
  });
  it('rejects tampering, wrong secret and garbage', () => {
    const tok = signMediaToken(secret, id, exp);
    expect(verifyMediaToken('other', tok, t0).ok).toBe(false);
    expect(verifyMediaToken(secret, tok.slice(0, -2) + 'xx', t0).ok).toBe(false);
    expect(verifyMediaToken(secret, 'a.b.c', t0).ok).toBe(false);
    expect(verifyMediaToken(secret, '', t0).ok).toBe(false);
  });
  it('contains no raw storage path', () => {
    expect(signMediaToken(secret, id, exp)).not.toContain('/');
  });
});
