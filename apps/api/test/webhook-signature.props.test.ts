import type { Server } from 'node:http';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signBody, verifySignature } from '../src/channels/line/signature.js';
import type { LineChannelKey } from '../src/config/line.js';
import type { IncomingLineEvent, WebhookService } from '../src/services/webhooks/index.js';
import { SECRETS, post, sign, startApp } from './webhook-helper.js';

// Feature: agrimatch-mvp, Property 15: Webhook signature round trip and tamper detection
// **Validates: Requirements 2.2**
const RUNS = { numRuns: 100 };
const bodyArb = fc.uint8Array({ minLength: 1, maxLength: 200 }).map((u) => Buffer.from(u));
const secretArb = fc.string({ minLength: 1, maxLength: 40 });
const roleArb = fc.constantFrom<LineChannelKey>('farmer', 'baler', 'factory');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

describe('Property 15: verifySignature (pure)', () => {
  it('valid iff header equals base64 HMAC-SHA256(secret, body)', () => {
    fc.assert(fc.property(secretArb, bodyArb, (secret, body) => {
      const sig = signBody(secret, body);
      expect(sig).toMatch(/^[A-Za-z0-9+/]{43}=$/);
      expect(verifySignature(secret, body, sig)).toBe(true);
    }), RUNS);
  });

  it('any single-byte change of the body fails', () => {
    fc.assert(fc.property(secretArb, bodyArb, fc.nat(), fc.integer({ min: 1, max: 255 }), (secret, body, i, delta) => {
      const sig = signBody(secret, body);
      const tampered = Buffer.from(body);
      const idx = i % tampered.length;
      tampered[idx] = (tampered[idx]! + delta) % 256;
      expect(verifySignature(secret, tampered, sig)).toBe(false);
    }), RUNS);
  });

  it('any single-character change of the signature fails', () => {
    fc.assert(fc.property(secretArb, bodyArb, fc.nat(), fc.nat(), (secret, body, i, j) => {
      const sig = signBody(secret, body);
      const idx = i % sig.length;
      const pool = [...B64, '='].filter((c) => c !== sig[idx]);
      const repl = pool[j % pool.length]!;
      expect(verifySignature(secret, body, sig.slice(0, idx) + repl + sig.slice(idx + 1))).toBe(false);
    }), RUNS);
  });

  it("a different secret (the other role's) fails", () => {
    fc.assert(fc.property(secretArb, secretArb, bodyArb, (s1, s2, body) => {
      fc.pre(s1 !== s2);
      expect(verifySignature(s2, body, signBody(s1, body))).toBe(false);
    }), RUNS);
    fc.assert(fc.property(roleArb, roleArb, bodyArb, (a, b, body) => {
      fc.pre(a !== b);
      expect(verifySignature(SECRETS[b], body, signBody(SECRETS[a], body))).toBe(false);
    }), RUNS);
  });

  it('length-mismatched and non-base64 headers fail without throwing', () => {
    fc.assert(fc.property(secretArb, bodyArb, fc.string({ maxLength: 120 }), (secret, body, header) => {
      fc.pre(header !== signBody(secret, body));
      expect(() => verifySignature(secret, body, header)).not.toThrow();
      expect(verifySignature(secret, body, header)).toBe(false);
    }), RUNS);
    fc.assert(fc.property(secretArb, bodyArb, fc.string({ unit: 'binary', maxLength: 60 }), fc.nat({ max: 10 }), (secret, body, junk, extra) => {
      const sig = signBody(secret, body);
      for (const h of [sig + junk + 'x'.repeat(extra + 1), sig.slice(0, sig.length - 1 - extra), junk.replace(/[A-Za-z0-9+/=]/g, '!') + '!']) {
        expect(() => verifySignature(secret, body, h)).not.toThrow();
        expect(verifySignature(secret, body, h)).toBe(false);
      }
      expect(verifySignature(secret, body, '')).toBe(false);
      expect(verifySignature(secret, body, undefined)).toBe(false);
    }), RUNS);
  });
});

describe('Property 15: rejected webhook requests over HTTP', () => {
  const calls: Array<{ channel: string; events: readonly IncomingLineEvent[] }> = [];
  const service: WebhookService = { ingest: async (channel, events) => { calls.push({ channel, events }); return { received: events.length, created: events.length }; } };
  let server: Server; let base: string;
  beforeAll(async () => { ({ base, server } = await startApp(service)); });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const validBody = (text: string) => JSON.stringify({ destination: 'Usynthetic', events: [{ type: 'message', webhookEventId: 'e-prop', timestamp: 1, source: { type: 'user', userId: 'U-synthetic' }, message: { type: 'text', text } }] });
  const textArb = fc.string({ minLength: 1, maxLength: 30 });
  const asciiHeader = fc.string({ unit: fc.constantFrom(...[...B64, '=', '-', '_', ' ']), maxLength: 80 });

  it('tampered body, wrong role secret, or arbitrary header gives 401 and no ingest', async () => {
    calls.length = 0;
    await fc.assert(fc.asyncProperty(roleArb, roleArb, textArb, fc.nat(), asciiHeader, async (role, other, text, i, junk) => {
      const body = validBody(text);
      const tampered = body.slice(0, i % body.length) + (body[i % body.length] === 'Z' ? 'Y' : 'Z') + body.slice((i % body.length) + 1);
      const attempts: Array<[string, string | undefined]> = [[tampered, sign(role, body)], [body, junk === sign(role, body) ? 'x' : junk.trim() || undefined]];
      if (other !== role) attempts.push([body, sign(other, body)]);
      for (const [b, sig] of attempts) {
        const res = await post(base, role, b, sig);
        expect(res.status).toBe(401);
      }
      expect(calls).toHaveLength(0);
    }), RUNS);
  }, 60_000);
});
