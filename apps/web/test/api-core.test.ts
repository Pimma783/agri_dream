import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiRequestError, createApiCore, SessionExpiredError } from '@/lib/api-core';

const me = { user: { id: 'u' }, org: { id: 'o', name: 'org' }, role: 'FARMER', csrf_secret: 'sec1' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function harness(handler: (url: string, init: RequestInit, n: number) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  }) as unknown as typeof fetch;
  return { calls, api: createApiCore({ baseUrl: '/api', fetchImpl, extraHeaders: () => ({ cookie: 'agrimatch_sid=x' }) }) };
}
const hdr = (init: RequestInit, k: string) => (init.headers as Record<string, string>)[k];

describe('api core', () => {
  it('does not send CSRF on GET and validates with the schema', async () => {
    const { api, calls } = harness(() => json(200, { a: 1 }));
    expect(await api.get('/x', z.object({ a: z.number() }))).toEqual({ a: 1 });
    expect(hdr(calls[0]!.init, 'x-csrf-token')).toBeUndefined();
    expect(hdr(calls[0]!.init, 'cookie')).toBe('agrimatch_sid=x');
  });
  it('reads csrf_secret from /me and sends X-CSRF-Token on POST', async () => {
    const { api, calls } = harness((url) => (url === '/api/me' ? json(200, me) : json(200, { ok: true })));
    await api.post('/offers', z.object({ ok: z.boolean() }), { q: 1 });
    expect(calls.map((c) => c.url)).toEqual(['/api/me', '/api/offers']);
    expect(hdr(calls[1]!.init, 'x-csrf-token')).toBe('sec1');
    await api.post('/offers', z.object({ ok: z.boolean() }), {});
    expect(calls).toHaveLength(3); // secret is cached
  });
  it('refreshes the secret once after a CSRF error', async () => {
    let meCalls = 0;
    const { api, calls } = harness((url, _i, n) => {
      if (url === '/api/me') return json(200, { ...me, csrf_secret: `s${++meCalls}` });
      return n === 2 ? json(403, { error: { code: 'CSRF', message_th: 'x' } }) : json(200, { ok: true });
    });
    await api.post('/offers', z.object({ ok: z.boolean() }), {});
    expect(hdr(calls.at(-1)!.init, 'x-csrf-token')).toBe('s2');
  });
  it('maps 401 to SessionExpiredError', async () => {
    const { api } = harness(() => json(401, { error: { code: 'UNAUTHENTICATED', message_th: 'x' } }));
    await expect(api.get('/x', z.unknown())).rejects.toBeInstanceOf(SessionExpiredError);
    expect(await api.getMe()).toBeNull();
  });
  it('maps API errors, bad bodies and network failures', async () => {
    const a = harness(() => json(409, { error: { code: 'STALE_VERSION', message_th: 'ข้อมูลเก่า' } }));
    await expect(a.api.get('/x', z.unknown())).rejects.toMatchObject({ code: 'STALE_VERSION', messageTh: 'ข้อมูลเก่า' });
    const b = harness(() => json(200, { wrong: true }));
    await expect(b.api.get('/x', z.object({ a: z.number() }))).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    const c = createApiCore({ baseUrl: '/api', fetchImpl: (async () => { throw new TypeError('down'); }) as unknown as typeof fetch });
    await expect(c.get('/x', z.unknown())).rejects.toBeInstanceOf(ApiRequestError);
  });
});
