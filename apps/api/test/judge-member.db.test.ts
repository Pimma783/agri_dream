// The limited judge account: a MEMBER of a BUYER_FACTORY organization (task 26.1). Synthetic data only.
// Authorization is by organization kind, so a MEMBER can do the demo actions; no route manages members,
// invitations or organization settings, and another organization's rows stay invisible.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvSchema } from '../src/config/env.js';
import { createApp } from '../src/http/app.js';
import { mountAgreementRoutes } from '../src/http/agreement-routes.js';
import { mountMatchRoutes } from '../src/http/match-routes.js';
import { mountNotificationRoutes } from '../src/http/notification-routes.js';
import { mountOfferRoutes } from '../src/http/offer-routes.js';
import { mountResourceRoutes } from '../src/http/resource-routes.js';
import { createLogger } from '../src/logger.js';
import { memberships } from '../src/repos/index.js';
import { createAuthService, createDemoOrgUser, LoginRateLimiter } from '../src/services/auth/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
const ORIGIN = 'http://localhost:3000';
const PW = 'synthetic-Passw0rd-for-tests';
const DEMAND = {
  accepted_materials: ['RICE_STRAW'], target_quantity: { value: '20', unit: 'ton' },
  price_mode: 'NEGOTIABLE', province: 'Nakhon Sawan',
};
interface Session { cookie: string; csrf: string }
describe.skipIf(!testDatabaseUrl)('judge MEMBER account (real Postgres)', () => {
  let db: TestDb;
  let server: Server;
  let base: string;
  let seq = 0;
  beforeAll(async () => {
    db = await createTestDb();
    const auth = createAuthService({
      pool: db.pool, config: { idleMs: 3_600_000, absoluteMs: 18_000_000 },
      limiter: new LoginRateLimiter({ maxAttempts: 1000, windowMs: 60_000 }),
    });
    const env = EnvSchema.parse({ NODE_ENV: 'test', WEB_ORIGIN: ORIGIN });
    const app = createApp({
      env, logger: createLogger('silent'), auth,
      mountRoutes: (a) => {
        const ctx = { pool: db.pool };
        mountResourceRoutes(a, ctx); mountMatchRoutes(a, ctx); mountNotificationRoutes(a, ctx);
        mountOfferRoutes(a, ctx); mountAgreementRoutes(a, ctx);
      },
    });
    server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    await db?.close();
  });
  async function loginAs(memberRole: 'OWNER' | 'MEMBER'): Promise<{ s: Session; userId: string; orgId: string }> {
    const email = `judge-${++seq}@example.invalid`;
    const { user, org } = await createDemoOrgUser(db.pool, {
      kind: 'BUYER_FACTORY', orgName: `synthetic-judge-org-${seq}`, email, password: PW, memberRole,
    });
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password: PW }),
    });
    expect(res.status).toBe(204);
    const cookie = `agrimatch_sid=${/agrimatch_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`;
    const me = (await (await fetch(`${base}/me`, { headers: { cookie } })).json()) as { csrf_secret: string };
    return { s: { cookie, csrf: me.csrf_secret }, userId: user.id, orgId: org.id };
  }
  async function call(s: Session, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { cookie: s.cookie };
    if (method !== 'GET') { headers.origin = ORIGIN; headers['x-csrf-token'] = s.csrf; }
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
  }
  it('stores the MEMBER role, never OWNER', async () => {
    const j = await loginAs('MEMBER');
    expect((await memberships.get(db.pool, j.userId, j.orgId))?.member_role).toBe('MEMBER');
  });
  it('MEMBER can create and publish a demand, and read matches, notifications, offers and agreements', async () => {
    const j = await loginAs('MEMBER');
    const d = await call(j.s, 'POST', '/drafts', { kind: 'PURCHASE_DEMAND', patch: DEMAND });
    expect(d.status).toBe(201);
    const p = await call(j.s, 'POST', `/drafts/${d.body.draft.id}/publish`, { expectedVersion: d.body.draft.version });
    expect(p.status).toBe(200);
    for (const path of ['/purchase-demands', '/matches', '/notifications', '/offers', '/agreements']) {
      expect((await call(j.s, 'GET', path)).status, path).toBe(200);
    }
    expect((await call(j.s, 'POST', '/notifications/read-all')).status).toBe(200);
  });
  it('MEMBER cannot see another organization\'s demand or offers', async () => {
    const owner = await loginAs('OWNER');
    const d = await call(owner.s, 'POST', '/drafts', { kind: 'PURCHASE_DEMAND', patch: DEMAND });
    const p = await call(owner.s, 'POST', `/drafts/${d.body.draft.id}/publish`, { expectedVersion: d.body.draft.version });
    const demandId = p.body.id ?? p.body.demand?.id;
    const j = await loginAs('MEMBER');
    const mine = await call(j.s, 'GET', '/purchase-demands');
    expect(JSON.stringify(mine.body)).not.toContain(String(demandId));
    expect((await call(j.s, 'GET', `/offers/${owner.orgId}`)).status).toBe(404);
  });
  it('exposes no member, invitation or organization-settings routes', async () => {
    const j = await loginAs('MEMBER');
    for (const [m, path] of [['GET', '/members'], ['POST', '/members'], ['POST', '/invitations'], ['PATCH', '/organization'], ['PATCH', `/organizations/${j.orgId}`]] as const) {
      expect((await call(j.s, m, path, m === 'GET' ? undefined : {})).status, `${m} ${path}`).toBe(404);
    }
  });
});
