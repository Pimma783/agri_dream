import { createHmac, timingSafeEqual } from 'node:crypto';
/** Base64 HMAC-SHA256 of the raw request body, as LINE sends in X-Line-Signature. */
export function signBody(channelSecret: string, rawBody: Buffer): string {
  return createHmac('sha256', channelSecret).update(rawBody).digest('base64');
}
/** Constant-time check of X-Line-Signature over the exact bytes received. Missing or malformed headers fail. */
export function verifySignature(channelSecret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header || !channelSecret) return false;
  const expected = Buffer.from(signBody(channelSecret, rawBody));
  const given = Buffer.from(header);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
