// Unit tests for auth pieces that need no database (Requirement 3.5-3.8). All values are synthetic.
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { EnvSchema } from '../src/config/env.js';
import { createApp } from '../src/http/app.js';
import { readCookie, SESSION_COOKIE } from '../src/http/session.js';
import { createLogger } from '../src/logger.js';
import { type AuthService, type AuthSession, LoginRateLimiter, hashPassword, verifyPassword } from '../src/services/auth/index.js';

const ORIGIN = 'http://localhost:3000';
const TOKEN = 'synthetic-token';
const session: AuthSession = {
  user: { id: '00000000-0000-4000-8000-000000000001', email: 'a@example.invalid', displayName: 'Synthetic' },
  org: { id: '00000000-0000-4000-8000-000000000002', kind: 'FARMER', name: 'Synthetic org' },
  actor: null,
  csrfSecret: 'synthetic-csrf-secret',
  expiresAt: new Date('2030-01-01T00:00:00Z'),
  extended: false,
};
const fakeAuth = (over: Partial<AuthService> = {}): AuthService => ({
  login: async () => ({ ok: true, value: { token: TOKEN, expiresAt: new Date('2030-01-01T00:00:00Z') } }),
  logout: async () => {},
  resolveSession: async (t) => (t === TOKEN ? session : null),
  ...over,
});

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));
async function start(nodeEnv: 'development' | 'production', auth = fakeAuth(), extra: Record<string, string> = {}) {
  const env = EnvSchema.parse({ NODE_ENV: nodeEnv, WEB_ORIGIN: ORIGIN, ...extra });
  const app = createApp({
    env, logger: createLogger('silent'), auth,
    mountRoutes: (a) => {
      a.post('/webhooks/line/farmer', (_req, res) => void res.status(200).json({ ok: true }));
      a.post('/probe', (_req, res) => void res.status(200).json({ ok: true }));
    },
  });
  server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const post = (url: string, headers: Record<string, string> = {}, body: unknown = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const cookie = { cookie: `${SESSION_COOKIE}=${TOKEN}` };

describe('session cookie flags', () => {
  const login = { email: 'a@example.invalid', password: 'synthetic-password' };
  it('is HttpOnly, SameSite=Lax and not Secure over plain HTTP in development', async () => {
    const base = await start('development');
    const res = await post(`${base}/auth/login`, {}, login);
    expect(res.status).toBe(204);
    const c = res.headers.get('set-cookie') ?? '';
    expect(c).toContain(`${SESSION_COOKIE}=${TOKEN}`);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).toMatch(/Path=\//);
    expect(c).not.toMatch(/Secure/i);
  });
  it('is Secure in production', async () => {
    const base = await start('production');
    const c = (await post(`${base}/auth/login`, {}, login)).headers.get('set-cookie') ?? '';
    expect(c).toMatch(/Secure/i);
    expect(c).toMatch(/HttpOnly/i);
  });
  it('is Secure in development when a trusted proxy says the request was HTTPS', async () => {
    const base = await start('development');
    const c = (await post(`${base}/auth/login`, { 'x-forwarded-proto': 'https' }, login)).headers.get('set-cookie') ?? '';
    expect(c).toMatch(/Secure/i);
  });
});

describe('CSRF middleware', () => {
  const good = { ...cookie, origin: ORIGIN, 'x-csrf-token': session.csrfSecret };
  it('lets a request with allowed Origin and matching token through', async () => {
    const base = await start('development');
    expect((await post(`${base}/probe`, good)).status).toBe(200);
  });
  it('rejects a missing Origin, a foreign Origin, and a missing or wrong token with 403 CSRF', async () => {
    const base = await start('development');
    for (const h of [
      { ...good, origin: undefined },
      { ...good, origin: 'http://evil.example.invalid' },
      { ...cookie, origin: ORIGIN },
      { ...cookie, origin: ORIGIN, 'x-csrf-token': 'wrong' },
    ]) {
      const clean = Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) as Record<string, string>;
      const res = await post(`${base}/probe`, clean);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CSRF');
    }
  });
  it('returns 401 for a state-changing request without a session', async () => {
    const base = await start('development');
    const res = await post(`${base}/probe`, { origin: ORIGIN });
    expect(res.status).toBe(401);
  });
  it('does not check CSRF on GET', async () => {
    const base = await start('development');
    expect((await fetch(`${base}/me`, { headers: cookie })).status).toBe(200);
  });
  it('exempts /webhooks/* and /auth/login from the token', async () => {
    const base = await start('development');
    expect((await post(`${base}/webhooks/line/farmer`)).status).toBe(200);
    expect((await post(`${base}/auth/login`, {}, { email: 'a@example.invalid', password: 'x' })).status).toBe(204);
  });
  it('still refuses a foreign Origin on login', async () => {
    const base = await start('development');
    const res = await post(`${base}/auth/login`, { origin: 'http://evil.example.invalid' }, { email: 'a@example.invalid', password: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('GET /me and routes', () => {
  it('requires a session and returns csrf_secret to a valid one', async () => {
    const base = await start('development');
    expect((await fetch(`${base}/me`)).status).toBe(401);
    expect((await fetch(`${base}/me`, { headers: { cookie: `${SESSION_COOKIE}=nope` } })).status).toBe(401);
    const body = (await (await fetch(`${base}/me`, { headers: cookie })).json()) as Record<string, unknown>;
    expect(body.csrf_secret).toBe(session.csrfSecret);
    expect(body.role).toBe('FARMER');
  });
  it('maps bad credentials to 401 and a throttled login to 429 with Retry-After', async () => {
    const base = await start('development', fakeAuth({
      login: async ({ password }) => password === 'limit'
        ? { ok: false, error: { code: 'RATE_LIMITED', status: 429, retryAfterSeconds: 42 } }
        : { ok: false, error: { code: 'INVALID_CREDENTIALS', status: 401 } },
    }));
    const bad = await post(`${base}/auth/login`, {}, { email: 'a@example.invalid', password: 'x' });
    expect(bad.status).toBe(401);
    const limited = await post(`${base}/auth/login`, {}, { email: 'a@example.invalid', password: 'limit' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('42');
  });
  it('rejects a malformed login body with 400', async () => {
    const base = await start('development');
    expect((await post(`${base}/auth/login`, {}, { email: 'a@example.invalid' })).status).toBe(400);
  });
  it('logout clears the cookie', async () => {
    let loggedOut = '';
    const base = await start('development', fakeAuth({ logout: async (t) => { loggedOut = t; } }));
    const res = await post(`${base}/auth/logout`, { cookie: cookie.cookie, origin: ORIGIN, 'x-csrf-token': session.csrfSecret });
    expect(res.status).toBe(204);
    expect(loggedOut).toBe(TOKEN);
    expect(res.headers.get('set-cookie')).toMatch(/agrimatch_sid=;/);
  });
});

describe('readCookie', () => {
  it('finds a cookie among several and ignores malformed ones', () => {
    expect(readCookie('a=1; agrimatch_sid=abc; b=2', 'agrimatch_sid')).toBe('abc');
    expect(readCookie('agrimatch_sid=%E0%A4%A', 'agrimatch_sid')).toBeUndefined();
    expect(readCookie(undefined, 'x')).toBeUndefined();
  });
});

describe('LoginRateLimiter', () => {
  const opts = { maxAttempts: 3, windowMs: 60_000 };
  it('blocks after max failures, per IP+email, and unblocks after the window', () => {
    const l = new LoginRateLimiter(opts);
    const k = LoginRateLimiter.key('1.1.1.1', 'A@Example.invalid');
    expect(k).toBe(LoginRateLimiter.key('1.1.1.1', ' a@example.invalid '));
    for (let i = 0; i < 3; i++) { expect(l.retryAfterSeconds(k, i)).toBe(0); l.recordFailure(k, i); }
    expect(l.retryAfterSeconds(k, 1000)).toBeGreaterThan(0);
    expect(l.retryAfterSeconds(LoginRateLimiter.key('2.2.2.2', 'a@example.invalid'), 1000)).toBe(0);
    expect(l.retryAfterSeconds(k, 60_001)).toBe(0);
  });
  it('reset clears the counter and the map stays bounded', () => {
    const l = new LoginRateLimiter({ ...opts, maxKeys: 5 });
    const k = 'k';
    l.recordFailure(k, 0); l.reset(k);
    expect(l.size).toBe(0);
    for (let i = 0; i < 50; i++) l.recordFailure(`k${i}`, i);
    expect(l.size).toBeLessThanOrEqual(5);
  });
});

describe('passwords', () => {
  it('hashes with argon2id and verifies; wrong, missing and malformed hashes all fail', async () => {
    const h = await hashPassword('synthetic-pass-1');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'synthetic-pass-1')).toBe(true);
    expect(await verifyPassword(h, 'other')).toBe(false);
    expect(await verifyPassword(null, 'synthetic-pass-1')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
  it('spends comparable time on an unknown account as on a wrong password', async () => {
    const h = await hashPassword('synthetic-pass-1');
    await verifyPassword(null, 'warm');
    const t = async (fn: () => Promise<unknown>) => { const s = performance.now(); await fn(); return performance.now() - s; };
    const known = await t(() => verifyPassword(h, 'wrong'));
    const unknown = await t(() => verifyPassword(null, 'wrong'));
    expect(unknown).toBeGreaterThan(known / 4); // a skipped hash would be orders of magnitude faster
  });
});

describe('log redaction', () => {
  it('never writes passwords, tokens, cookies or CSRF values', () => {
    let out = '';
    const sink = new Writable({ write(c, _e, cb) { out += String(c); cb(); } });
    const log = createLogger('info', sink);
    log.info({ password: 'pw-secret-1', body: { password: 'pw-secret-2' }, headers: { cookie: 'agrimatch_sid=tok-1', 'x-csrf-token': 'csrf-1' }, csrf_secret: 'csrf-2', token: 'tok-2' }, 'login');
    for (const s of ['pw-secret-1', 'pw-secret-2', 'tok-1', 'tok-2', 'csrf-1', 'csrf-2']) expect(out).not.toContain(s);
  });
});
