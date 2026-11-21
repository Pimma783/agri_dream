import { createHmac, timingSafeEqual } from 'node:crypto';
// Short-lived signed content tokens: base64url(`${mediaId}.${expiresAtMs}`) + '.' + HMAC-SHA256.
// The token carries no storage key. Serving still re-authorizes the actor; the token only bounds link lifetime.
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const mac = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url');
export function signMediaToken(secret: string, mediaId: string, expiresAt: Date): string {
  const payload = b64(`${mediaId}.${expiresAt.getTime()}`);
  return `${payload}.${mac(secret, payload)}`;
}
export type TokenCheck = { ok: true; mediaId: string } | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' };
export function verifyMediaToken(secret: string, token: string, now: Date): TokenCheck {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'MALFORMED' };
  const [payload, sig] = parts as [string, string];
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(secret, payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'BAD_SIGNATURE' };
  const decoded = Buffer.from(payload, 'base64url').toString();
  const i = decoded.lastIndexOf('.');
  const exp = Number(decoded.slice(i + 1));
  const mediaId = decoded.slice(0, i);
  if (i <= 0 || !Number.isFinite(exp) || !mediaId) return { ok: false, reason: 'MALFORMED' };
  if (now.getTime() >= exp) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, mediaId };
}
