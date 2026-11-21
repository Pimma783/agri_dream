// POST /line-link-codes and GET /line-identities through the real app and Postgres (Requirements 3.1-3.4, 3.6).
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvSchema } from '../src/config/env.js';
import { createApp } from '../src/http/app.js';
import { lineLinkRoutes } from '../src/http/line-link-routes.js';
import { createLogger } from '../src/logger.js';
import { many } from '../src/repos/index.js';
import { createAuthService, createDemoOrgUser, LoginRateLimiter, sha256Hex } from '../src/services/auth/index.js';
import { createLineIdentityService } from '../src/services/identity/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
const ORIGIN = 'http://localhost:3000';
const PW = 'synthetic-Passw0rd-for-tests';
describe.skipIf(!testDatabaseUrl)('line link routes (real Postgres)', () => {
  let db: TestDb;
  let server: Server;
  let base: string;
  let seq = 0;
  beforeAll(async () => {
    db = await createTestDb();
    const auth = createAuthService({
      pool: db.pool, config: { idleMs: 3_600_000, absoluteMs: 18_000_000 },
      limiter: new LoginRateLimiter({ maxAttempts: 100, windowMs: 60_000 }),
    });
    const identity = createLineIdentityService({ pool: db.pool, config: { linkCodeTtlMs: 600_000 } });
    const env = EnvSchema.parse({ NODE_ENV: 'test', WEB_ORIGIN: ORIGIN });
    const app = createApp({
      env, logger: createLogger('silent'), auth,
      mountRoutes: (a) => void a.use(lineLinkRoutes(identity, { baler: '@synthetic-baler' })),
    });
    server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    await db?.close();
  });
  async function session(kind: 'FARMER' | 'BALER' | 'BUYER_FACTORY') {
    const email = `link-${++seq}@example.invalid`;
    await createDemoOrgUser(db.pool, { kind, orgName: `synthetic-org-${seq}`, email, password: PW });
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }),
    });
    const sid = /agrimatch_sid=([^;]+)/.exec(login.headers.get('set-cookie') ?? '')![1]!;
    const cookie = `agrimatch_sid=${sid}`;
    const me = (await (await fetch(`${base}/me`, { headers: { cookie } })).json()) as { csrf_secret: string };
    const post = (channel: unknown, csrf: string | null = me.csrf_secret) =>
      fetch(`${base}/line-link-codes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: ORIGIN, ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        body: JSON.stringify({ channel }),
      });
    return { cookie, post, status: () => fetch(`${base}/line-identities`, { headers: { cookie } }) };
  }
  it('requires a session', async () => {
    expect((await fetch(`${base}/line-identities`)).status).toBe(401);
    const res = await fetch(`${base}/line-link-codes`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ channel: 'baler' }),
    });
    expect(res.status).toBe(401);
  });
  it('issues a code once with expiry, stores only its hash, and requires the CSRF token', async () => {
    const s = await session('BALER');
    expect((await s.post('baler', null)).status).toBe(403);
    const res = await s.post('baler');
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { channel: string; code: string; expires_at: string; basic_id: string | null };
    expect(body.channel).toBe('baler');
    expect(body.code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(body.basic_id).toBe('@synthetic-baler');
    const ttl = new Date(body.expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);
    const stored = await many(db.pool, z.object({ n: z.coerce.number() }),
      'SELECT count(*) AS n FROM line_link_codes WHERE code_hash = $1', [sha256Hex(body.code)]);
    expect(stored[0]!.n).toBe(1);
    // The code is never returned again: status carries no code.
    const st = JSON.stringify(await (await s.status()).json());
    expect(st).not.toContain(body.code);
  });
  it('refuses a channel that is not the member role and a malformed body', async () => {
    const s = await session('FARMER');
    expect((await s.post('baler')).status).toBe(403);
    expect((await s.post('factory')).status).toBe(403);
    expect((await s.post('nope')).status).toBe(400);
  });
  it('reports the status for the role channel only, UNLINKED until a code is redeemed', async () => {
    const s = await session('BUYER_FACTORY');
    const body = (await (await s.status()).json()) as { items: Array<{ channel: string; status: string; basic_id: string | null }> };
    expect(body.items).toEqual([{ channel: 'factory', status: 'UNLINKED', basic_id: null }]);
  });
  it('shows LINKED after the code is redeemed through the identity service', async () => {
    const s = await session('BALER');
    const code = ((await (await s.post('baler')).json()) as { code: string }).code;
    const identity = createLineIdentityService({ pool: db.pool, config: { linkCodeTtlMs: 600_000 } });
    expect((await identity.redeemLinkCode({ channel: 'baler', lineUserId: `U-synthetic-${++seq}`, code })).ok).toBe(true);
    const body = (await (await s.status()).json()) as { items: Array<{ status: string }> };
    expect(body.items[0]!.status).toBe('LINKED');
  });
});
