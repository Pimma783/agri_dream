// Login, sessions and CSRF against real Postgres (Requirement 3.5-3.7). Passwords and addresses are synthetic.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvSchema } from '../src/config/env.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/logger.js';
import { exec, memberships, many, sessions } from '../src/repos/index.js';
import {
  createAuthService, createDemoOrgUser, LoginRateLimiter, sha256Hex, verifyPassword,
} from '../src/services/auth/index.js';
import { z } from 'zod';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';

const ORIGIN = 'http://localhost:3000';
const PW = 'synthetic-Passw0rd-for-tests';
const IDLE = 60 * 60_000;
const ABS = 5 * 60 * 60_000;

describe.skipIf(!testDatabaseUrl)('auth (real Postgres)', () => {
  let db: TestDb;
  let server: Server;
  let base: string;
  let clock = new Date('2030-01-01T00:00:00Z');
  const limiter = new LoginRateLimiter({ maxAttempts: 3, windowMs: 60_000 });
  let seq = 0;
  const email = () => `user-${++seq}@example.invalid`;

  beforeAll(async () => {
    db = await createTestDb();
    const auth = createAuthService({
      pool: db.pool, config: { idleMs: IDLE, absoluteMs: ABS }, limiter, now: () => clock,
    });
    const env = EnvSchema.parse({ NODE_ENV: 'test', WEB_ORIGIN: ORIGIN });
    const app = createApp({
      env, logger: createLogger('silent'), auth,
      mountRoutes: (a) => void a.post('/probe', (_q, r) => void r.json({ ok: true })),
    });
    server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    await db?.close();
  });

  const login = (e: string, p: string, ip = '10.0.0.1') =>
    fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email: e, password: p }),
    });
  const sid = (res: Response) => /agrimatch_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  const me = (token: string) => fetch(`${base}/me`, { headers: { cookie: `agrimatch_sid=${token}` } });
  const seed = (kind: 'FARMER' | 'BALER' | 'BUYER_FACTORY' = 'BALER') =>
    createDemoOrgUser(db.pool, { kind, orgName: `synthetic-org-${++seq}`, email: email(), password: PW });
  const stored = () => many(db.pool, z.object({ token_hash: z.string(), csrf_secret: z.string() }), 'SELECT token_hash, csrf_secret FROM sessions');

  it('seed helper stores an argon2id hash, flags demo rows and creates an OWNER membership', async () => {
    const { org, user } = await seed();
    expect(user.is_demo && org.is_demo).toBe(true);
    expect(user.password_hash?.startsWith('$argon2id$')).toBe(true);
    expect(user.password_hash).not.toContain(PW);
    expect(await verifyPassword(user.password_hash, PW)).toBe(true);
    expect((await memberships.get(db.pool, user.id, org.id))?.member_role).toBe('OWNER');
  });

  it('logs in, stores only sha256 of a 256-bit token, and serves /me with the role and csrf_secret', async () => {
    const { org, user } = await seed('BUYER_FACTORY');
    const res = await login(user.email!, PW);
    expect(res.status).toBe(204);
    const token = sid(res)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await stored();
    expect(rows.map((r) => r.token_hash)).toContain(sha256Hex(token));
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
    const body = (await (await me(token)).json()) as { org: { id: string }; role: string; csrf_secret: string; user: { id: string } };
    expect(body.user.id).toBe(user.id);
    expect(body.org.id).toBe(org.id);
    expect(body.role).toBe('BUYER_FACTORY');
    expect(rows.find((r) => r.token_hash === sha256Hex(token))?.csrf_secret).toBe(body.csrf_secret);
    expect(JSON.stringify(body)).not.toContain('password');
  });

  it('matches email case-insensitively', async () => {
    const { user } = await seed();
    expect((await login(user.email!.toUpperCase(), PW)).status).toBe(204);
  });

  it('gives the same 401 body for a wrong password and an unknown email, and creates no session', async () => {
    const { user } = await seed();
    const before = (await stored()).length;
    const wrong = await login(user.email!, 'wrong-password', '10.0.0.2');
    const unknown = await login('nobody@example.invalid', PW, '10.0.0.3');
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.get('set-cookie')).toBeNull();
    expect((await stored()).length).toBe(before);
  });

  it('throttles repeated failures per IP+email, resets on success, and leaves other keys alone', async () => {
    const { user } = await seed();
    const ip = '10.9.9.9';
    for (let i = 0; i < 3; i++) expect((await login(user.email!, 'bad', ip)).status).toBe(401);
    const blocked = await login(user.email!, PW, ip); // even the right password is refused while blocked
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await login(user.email!, PW, '10.9.9.10')).status).toBe(204); // different IP
    clock = new Date(clock.getTime() + 61_000);
    expect((await login(user.email!, PW, ip)).status).toBe(204);
  });

  it('logout deletes the session row and clears the cookie; the old token stops working', async () => {
    const { user } = await seed();
    const token = sid(await login(user.email!, PW))!;
    const me1 = await (await me(token)).json() as { csrf_secret: string };
    const out = await fetch(`${base}/auth/logout`, {
      method: 'POST', headers: { cookie: `agrimatch_sid=${token}`, origin: ORIGIN, 'x-csrf-token': me1.csrf_secret },
    });
    expect(out.status).toBe(204);
    expect(await sessions.getValid(db.pool, sha256Hex(token), clock)).toBeNull();
    expect((await me(token)).status).toBe(401);
  });

  it('requires the CSRF token on logout', async () => {
    const { user } = await seed();
    const token = sid(await login(user.email!, PW))!;
    const res = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: `agrimatch_sid=${token}`, origin: ORIGIN } });
    expect(res.status).toBe(403);
    expect((await me(token)).status).toBe(200);
  });

  it('expires on idle, slides while active, and ends at the absolute limit', async () => {
    const { user } = await seed();
    const t0 = clock;
    const token = sid(await login(user.email!, PW, '10.1.1.1'))!;
    clock = new Date(t0.getTime() + IDLE - 60_000); // still inside the idle window; this call slides it
    expect((await me(token)).status).toBe(200);
    clock = new Date(t0.getTime() + 2 * IDLE - 120_000); // beyond the original expiry, inside the slid one
    expect((await me(token)).status).toBe(200);
    clock = new Date(t0.getTime() + 4 * IDLE); // idle again, past the slid expiry
    expect((await me(token)).status).toBe(401);
    const t1 = clock;
    const t = sid(await login(user.email!, PW, '10.1.1.2'))!;
    for (let i = 1; i <= 4; i++) { clock = new Date(t1.getTime() + i * (IDLE - 60_000)); expect((await me(t)).status).toBe(200); }
    clock = new Date(t1.getTime() + ABS + 1000); // activity cannot push past created_at + absolute
    expect((await me(t)).status).toBe(401);
    const row = await many(db.pool, z.object({ over: z.boolean() }),
      `SELECT expires_at > created_at + ($2 * interval '1 millisecond') AS over FROM sessions WHERE token_hash = $1`,
      [sha256Hex(t), ABS]);
    expect(row).toEqual([{ over: false }]); // sliding never moved expiry past created_at + absolute limit
  });

  it('drops org rights when the membership is removed', async () => {
    const { user, org } = await seed();
    const token = sid(await login(user.email!, PW, '10.2.2.2'))!;
    await exec(db.pool, 'DELETE FROM memberships WHERE user_id = $1 AND org_id = $2', [user.id, org.id]);
    const body = (await (await me(token)).json()) as { org: unknown; role: unknown };
    expect(body.org).toBeNull();
    expect(body.role).toBeNull();
  });

  it('state-changing routes need Origin and X-CSRF-Token from /me with a real session', async () => {
    const { user } = await seed();
    const token = sid(await login(user.email!, PW, '10.3.3.3'))!;
    const { csrf_secret } = (await (await me(token)).json()) as { csrf_secret: string };
    const call = (h: Record<string, string>) => fetch(`${base}/probe`, { method: 'POST', headers: { cookie: `agrimatch_sid=${token}`, ...h } });
    expect((await call({})).status).toBe(403);
    expect((await call({ origin: ORIGIN })).status).toBe(403);
    expect((await call({ origin: ORIGIN, 'x-csrf-token': 'x' })).status).toBe(403);
    expect((await call({ origin: ORIGIN, 'x-csrf-token': csrf_secret })).status).toBe(200);
  });
});
