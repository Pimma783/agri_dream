import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signBody, verifySignature } from '../src/channels/line/signature.js';
import type { IncomingLineEvent, WebhookService } from '../src/services/webhooks/index.js';
import { evt, post, sign, startApp } from './webhook-helper.js';
describe('verifySignature', () => {
  const raw = Buffer.from('{"events":[]}');
  it('accepts the matching signature', () => expect(verifySignature('s', raw, signBody('s', raw))).toBe(true));
  it('rejects wrong secret, tampered body, missing and short headers', () => {
    expect(verifySignature('other', raw, signBody('s', raw))).toBe(false);
    expect(verifySignature('s', Buffer.from('{"events":[ ]}'), signBody('s', raw))).toBe(false);
    expect(verifySignature('s', raw, undefined)).toBe(false);
    expect(verifySignature('s', raw, '')).toBe(false);
    expect(verifySignature('s', raw, 'abc')).toBe(false);
  });
});
describe('webhook routes (service recorded in memory)', () => {
  const calls: Array<{ channel: string; events: readonly IncomingLineEvent[] }> = [];
  const service: WebhookService = { ingest: async (channel, events) => { calls.push({ channel, events }); return { received: events.length, created: events.length }; } };
  let server: Server; let base: string;
  beforeAll(async () => { ({ base, server } = await startApp(service)); });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const body = JSON.stringify({ destination: 'Usynthetic', events: [evt('e1')] });
  it('valid signature returns 200 and ingests', async () => {
    calls.length = 0;
    expect((await post(base, 'farmer', body, sign('farmer', body))).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.channel).toBe('farmer');
  });
  it('401 without ingest for wrong, other-role, tampered, missing and re-serialized cases', async () => {
    calls.length = 0;
    const reserialized = JSON.stringify(JSON.parse(body), null, 2);
    const cases: Array<[string, string, string | undefined]> = [
      ['farmer', body, 'wrong'],
      ['farmer', body, sign('baler', body)],
      ['baler', body, sign('farmer', body)],
      ['farmer', body + ' ', sign('farmer', body)],
      ['farmer', body, undefined],
      ['farmer', reserialized, sign('farmer', body)],
    ];
    for (const [role, b, sig] of cases) expect((await post(base, role, b, sig)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('401 even when the body is not JSON (no parse before verification)', async () => {
    expect((await post(base, 'farmer', 'not json', 'x')).status).toBe(401);
  });
  it('400 for validly signed bad shapes', async () => {
    for (const b of ['not json', '{}', '{"events":"x"}', '{"events":[{"type":"message"}]}']) {
      expect((await post(base, 'factory', b, sign('factory', b))).status).toBe(400);
    }
  });
  it('200 for empty events (LINE verify) and works with other content types', async () => {
    const b = '{"events":[]}';
    expect((await post(base, 'baler', b, sign('baler', b))).status).toBe(200);
    expect((await post(base, 'baler', b, sign('baler', b), 'text/plain')).status).toBe(200);
  });
});
