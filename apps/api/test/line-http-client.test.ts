import { describe, expect, it } from 'vitest';
import { HttpLineClient, selectLineClient, FakeLineClient } from '../src/adapters/line/index.js';
import { EnvSchema } from '../src/config/env.js';

interface Call { url: string; init: RequestInit }

function stub(...responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? new Response('{}', { status: 200 });
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const tokens = { farmer: 'tok-farmer', baler: 'tok-baler', factory: 'tok-factory' };
const input = { to: 'Uuser', messages: [{ type: 'text', text: 'hi' }], retryKey: '11111111-1111-4111-8111-111111111111' };
const headers = (c: Call) => c.init.headers as Record<string, string>;

describe('HttpLineClient push', () => {
  it('posts to the push endpoint with the channel token and retry key', async () => {
    const { calls, fetchFn } = stub(new Response('{}', { status: 200 }));
    const client = new HttpLineClient({ tokens, fetch: fetchFn });
    expect(client.kind).toBe('real');
    expect(await client.forChannel('baler').push(input)).toEqual({ ok: true, duplicate: false });
    expect(calls[0]!.url).toBe('https://api.line.me/v2/bot/message/push');
    expect(headers(calls[0]!).Authorization).toBe('Bearer tok-baler');
    expect(headers(calls[0]!)['X-Line-Retry-Key']).toBe(input.retryKey);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ to: 'Uuser', messages: input.messages });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('treats 409 as a duplicate success', async () => {
    const { fetchFn } = stub(new Response('{"message":"The retry key is already accepted"}', { status: 409 }));
    const r = await new HttpLineClient({ tokens, fetch: fetchFn }).forChannel('farmer').push(input);
    expect(r).toEqual({ ok: true, duplicate: true });
  });

  it('maps 429 to RATE_LIMITED with Retry-After', async () => {
    const { fetchFn } = stub(new Response('', { status: 429, headers: { 'Retry-After': '7' } }), new Response('', { status: 429 }));
    const ch = new HttpLineClient({ tokens, fetch: fetchFn }).forChannel('farmer');
    expect(await ch.push(input)).toEqual({ ok: false, code: 'RATE_LIMITED', retryAfterMs: 7000 });
    expect(await ch.push(input)).toEqual({ ok: false, code: 'RATE_LIMITED' });
  });

  it('maps 5xx, timeouts and network errors to retryable codes', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    const { fetchFn } = stub(new Response('', { status: 503 }), timeout, new TypeError('fetch failed'));
    const ch = new HttpLineClient({ tokens, fetch: fetchFn }).forChannel('farmer');
    expect(await ch.push(input)).toEqual({ ok: false, code: 'UPSTREAM_5XX' });
    expect(await ch.push(input)).toEqual({ ok: false, code: 'TIMEOUT' });
    expect(await ch.push(input)).toEqual({ ok: false, code: 'NETWORK' });
  });

  it('maps 4xx to permanent codes and never sends without a token', async () => {
    const { calls, fetchFn } = stub(new Response('', { status: 400 }), new Response('', { status: 401 }));
    const client = new HttpLineClient({ tokens: { farmer: 'x' }, fetch: fetchFn });
    expect(await client.forChannel('farmer').push(input)).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(await client.forChannel('farmer').push(input)).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    expect(await client.forChannel('factory').push(input)).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    expect(calls).toHaveLength(2);
  });

  it('rejects empty or oversized message lists without a call', async () => {
    const { calls, fetchFn } = stub();
    const ch = new HttpLineClient({ tokens, fetch: fetchFn }).forChannel('farmer');
    expect(await ch.push({ ...input, messages: [] })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(await ch.push({ ...input, messages: Array(6).fill({ type: 'text', text: 'x' }) })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(calls).toHaveLength(0);
  });

  it('does not leak the token or message text in results', async () => {
    const { fetchFn } = stub(new Response('boom tok-farmer hi', { status: 500 }));
    const r = await new HttpLineClient({ tokens, fetch: fetchFn }).forChannel('farmer').push(input);
    expect(JSON.stringify(r)).not.toMatch(/tok-farmer|hi/);
  });
});

describe('HttpLineClient reply', () => {
  it('posts the reply token with the channel token and no retry key', async () => {
    const { calls, fetchFn } = stub(new Response('{}', { status: 200 }), new Response('', { status: 409 }));
    const ch = new HttpLineClient({ tokens, fetch: fetchFn }).forChannel('factory');
    expect(await ch.reply({ replyToken: 'rt', messages: input.messages })).toEqual({ ok: true, duplicate: false });
    expect(calls[0]!.url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(headers(calls[0]!).Authorization).toBe('Bearer tok-factory');
    expect(headers(calls[0]!)['X-Line-Retry-Key']).toBeUndefined();
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ replyToken: 'rt', messages: input.messages });
    // 409 on a reply is not a retry-key duplicate.
    expect(await ch.reply({ replyToken: 'rt', messages: input.messages })).toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });
});

describe('HttpLineClient getContent', () => {
  it('downloads bytes from api-data with the channel token', async () => {
    const { calls, fetchFn } = stub(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
    const r = await new HttpLineClient({ tokens, fetch: fetchFn }).forChannel('farmer').getContent('123/4');
    expect(r).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' });
    expect(calls[0]!.url).toBe('https://api-data.line.me/v2/bot/message/123%2F4/content');
    expect(headers(calls[0]!).Authorization).toBe('Bearer tok-farmer');
  });

  it('enforces the size cap by header and by streamed bytes', async () => {
    const { fetchFn } = stub(
      new Response(new Uint8Array(4), { status: 200, headers: { 'Content-Length': '999' } }),
      new Response(new Uint8Array(20), { status: 200 }),
    );
    const ch = new HttpLineClient({ tokens, fetch: fetchFn, maxContentBytes: 10 }).forChannel('farmer');
    expect(await ch.getContent('1')).toEqual({ ok: false, code: 'TOO_LARGE' });
    expect(await ch.getContent('2')).toEqual({ ok: false, code: 'TOO_LARGE' });
  });

  it('maps failures to codes', async () => {
    const { fetchFn } = stub(new Response('', { status: 404 }), new Response('', { status: 500 }), new TypeError('x'));
    const ch = new HttpLineClient({ tokens, fetch: fetchFn }).forChannel('farmer');
    expect(await ch.getContent('1')).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(await ch.getContent('1')).toEqual({ ok: false, code: 'UPSTREAM_5XX' });
    expect(await ch.getContent('1')).toEqual({ ok: false, code: 'NETWORK' });
  });
});

describe('selectLineClient', () => {
  const base = EnvSchema.parse({});
  it('returns the fake unless ENABLE_REAL_LINE is true', () => {
    expect(selectLineClient(base)).toBeInstanceOf(FakeLineClient);
  });
  it('throws naming missing roles, not values', () => {
    const env = { ...base, ENABLE_REAL_LINE: true, LINE_FARMER_CHANNEL_SECRET: 's', LINE_FARMER_ACCESS_TOKEN: 'secret-token' };
    expect(() => selectLineClient(env)).toThrow(/baler, factory/);
    expect(() => selectLineClient(env)).not.toThrow(/secret-token/);
  });
  it('returns the real client when all channels are configured', () => {
    const env = { ...base, ENABLE_REAL_LINE: true };
    for (const r of ['FARMER', 'BALER', 'FACTORY']) {
      (env as Record<string, unknown>)[`LINE_${r}_CHANNEL_SECRET`] = 's';
      (env as Record<string, unknown>)[`LINE_${r}_ACCESS_TOKEN`] = `t-${r}`;
    }
    expect(selectLineClient(env).kind).toBe('real');
  });
});
