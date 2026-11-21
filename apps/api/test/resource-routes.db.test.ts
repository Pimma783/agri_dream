// REST routes for drafts, listings, demands and baling against real Postgres (task 6.5). Synthetic data only.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvSchema } from '../src/config/env.js';
import { createApp } from '../src/http/app.js';
import { mountResourceRoutes } from '../src/http/resource-routes.js';
import { createLogger } from '../src/logger.js';
import { createAuthService, createDemoOrgUser, LoginRateLimiter } from '../src/services/auth/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';

const ORIGIN = 'http://localhost:3000';
const PW = 'synthetic-Passw0rd-for-tests';
const SALE = {
  material_type: 'RICE_STRAW', quantity: { value: '5', unit: 'ton' },
  price_mode: 'FIXED', price: { value: '1.25', unit: 'kg' }, province: 'Uttaradit',
};
const DEMAND = {
  accepted_materials: ['RICE_STRAW'], target_quantity: { value: '20', unit: 'ton' },
  price_mode: 'NEGOTIABLE', province: 'Uttaradit',
};

interface Session { cookie: string; csrf: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Json { status: number; body: any }

describe.skipIf(!testDatabaseUrl)('resource routes (real Postgres)', () => {
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
      env, logger: createLogger('silent'), auth, mountRoutes: (a) => mountResourceRoutes(a, { pool: db.pool }),
    });
    server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    await db?.close();
  });

  async function loginAs(kind: 'FARMER' | 'BALER' | 'BUYER_FACTORY'): Promise<Session> {
    const email = `route-user-${++seq}@example.invalid`;
    await createDemoOrgUser(db.pool, { kind, orgName: `synthetic-org-${seq}`, email, password: PW });
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password: PW }),
    });
    expect(res.status).toBe(204);
    const cookie = `agrimatch_sid=${/agrimatch_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`;
    const me = (await (await fetch(`${base}/me`, { headers: { cookie } })).json()) as { csrf_secret: string };
    return { cookie, csrf: me.csrf_secret };
  }

  async function call(s: Session | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Json> {
    const headers: Record<string, string> = { ...extra };
    if (s) headers.cookie = s.cookie;
    if (s && method !== 'GET') { headers.origin = ORIGIN; headers['x-csrf-token'] = s.csrf; }
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async function publishedSale(s: Session) {
    const d = await call(s, 'POST', '/drafts', { kind: 'SALE_LISTING', patch: SALE });
    expect(d.status).toBe(201);
    const p = await call(s, 'POST', `/drafts/${d.body.draft.id}/publish`, { expectedVersion: d.body.draft.version });
    expect(p.status).toBe(200);
    return { draft: d.body.draft, published: p.body };
  }

  it('requires a session on every route (401)', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    for (const [m, p] of [
      ['GET', '/drafts'], ['POST', '/drafts'], ['GET', `/drafts/${id}`], ['PATCH', `/drafts/${id}`],
      ['POST', `/drafts/${id}/publish`], ['POST', `/drafts/${id}/cancel`], ['GET', '/listings'], ['GET', `/listings/${id}`],
      ['POST', `/listings/${id}/pause`], ['GET', '/purchase-demands'], ['POST', `/purchase-demands/${id}/close`],
      ['GET', '/baling-services'], ['POST', `/baling-services/${id}/open`], ['GET', '/baling-requests'],
      ['POST', `/baling-requests/${id}/cancel`],
    ] as const) {
      const r = await call(null, m, p, m === 'GET' ? undefined : {});
      expect(r.status, `${m} ${p}`).toBe(401);
      expect(r.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('rejects state-changing calls without a valid CSRF token or Origin (403)', async () => {
    const s = await loginAs('FARMER');
    const body = JSON.stringify({ kind: 'SALE_LISTING' });
    const post = (headers: Record<string, string>) =>
      fetch(`${base}/drafts`, { method: 'POST', headers: { cookie: s.cookie, 'content-type': 'application/json', ...headers }, body });
    expect((await post({ origin: ORIGIN })).status).toBe(403);
    expect((await post({ origin: ORIGIN, 'x-csrf-token': 'wrong' })).status).toBe(403);
    const noOrigin = await post({ 'x-csrf-token': s.csrf });
    expect(noOrigin.status).toBe(403);
    expect(((await noOrigin.json()) as { error: { code: string } }).error.code).toBe('CSRF');
    expect((await call(s, 'GET', '/drafts')).status).toBe(200); // reads need no CSRF token
  });

  it('creates, reads, lists and patches a draft (web channel); decimals are strings and times ISO UTC', async () => {
    const s = await loginAs('FARMER');
    const c = await call(s, 'POST', '/drafts', { kind: 'SALE_LISTING', patch: { material_type: 'RICE_STRAW' } });
    expect(c.status).toBe(201);
    expect(c.body.draft).toMatchObject({ status: 'DRAFT', version: 1 });
    expect(c.body.complete).toBe(false);
    const id = c.body.draft.id;
    expect((await call(s, 'GET', `/drafts/${id}`)).body.draft.id).toBe(id);
    expect((await call(s, 'GET', '/drafts')).body.map((v: { draft: { id: string } }) => v.draft.id)).toEqual([id]);
    const p = await call(s, 'PATCH', `/drafts/${id}`, { expectedVersion: 1, patch: { ...SALE } });
    expect(p.status).toBe(200);
    expect(p.body.draft).toMatchObject({ status: 'AWAITING_REVIEW', version: 2 });
    expect(p.body.draft.data.qty_kg).toBe('5000.000');
    expect(p.body.draft.created_at).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(p.body.complete).toBe(true);
  });

  it('returns 422 VALIDATION for malformed bodies and invalid patches', async () => {
    const s = await loginAs('FARMER');
    const bad = await call(s, 'POST', '/drafts', { kind: 'NOPE' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('VALIDATION');
    expect(bad.body.error.message_th).toEqual(expect.any(String));
    expect((await call(s, 'POST', '/drafts', { kind: 'SALE_LISTING', extra: 1 })).status).toBe(422);
    expect((await call(s, 'POST', '/drafts', { kind: 'RESALE_LISTING' })).status).toBe(422);
    const d = await call(s, 'POST', '/drafts', { kind: 'SALE_LISTING' });
    const id = d.body.draft.id;
    expect((await call(s, 'PATCH', `/drafts/${id}`, { patch: { province: 'X' } })).status).toBe(422); // no expectedVersion
    expect((await call(s, 'PATCH', `/drafts/${id}`, { expectedVersion: '1', patch: {} })).status).toBe(422);
    const badPatch = await call(s, 'PATCH', `/drafts/${id}`, { expectedVersion: 1, patch: { quantity: { value: '-5', unit: 'ton' } } });
    expect(badPatch.status).toBe(422);
    expect(badPatch.body.error.fields.length).toBeGreaterThan(0);
    expect((await call(s, 'POST', `/drafts/${id}/publish`, {})).status).toBe(422);
    const incomplete = await call(s, 'POST', `/drafts/${id}/publish`, { expectedVersion: 1 });
    expect(incomplete.status).toBe(422);
    expect((await call(s, 'POST', '/listings/not-a-uuid/pause', { expectedVersion: 1 })).status).toBe(422);
  });

  it('answers 404 for another organization\'s resources, identical to a missing id', async () => {
    const owner = await loginAs('FARMER');
    const other = await loginAs('FARMER');
    const { draft, published } = await publishedSale(owner);
    const missing = '00000000-0000-4000-8000-000000000001';
    const probes: Array<[string, string, unknown?]> = [
      ['GET', `/drafts/${draft.id}`], ['PATCH', `/drafts/${draft.id}`, { expectedVersion: 2, patch: { province: 'Y' } }],
      ['POST', `/drafts/${draft.id}/cancel`, { expectedVersion: 2 }], ['POST', `/drafts/${draft.id}/publish`, { expectedVersion: 2 }],
      ['GET', `/listings/${published.entity_id}`], ['POST', `/listings/${published.entity_id}/pause`, { expectedVersion: 1 }],
    ];
    for (const [m, p, b] of probes) {
      const foreign = await call(other, m, p, b);
      const gone = await call(other, m, p.replace(/[0-9a-f-]{36}/, missing), b);
      expect(foreign.status, `${m} ${p}`).toBe(404);
      expect(foreign.body).toEqual(gone.body);
    }
    expect((await call(other, 'GET', '/listings')).body).toEqual([]);
    expect((await call(other, 'GET', '/drafts')).body).toEqual([]);
    // the owner is unaffected
    expect((await call(owner, 'GET', `/listings/${published.entity_id}`)).body.status).toBe('PUBLISHED');
  });

  it('returns 409 STALE_VERSION with the current version for a stale patch, publish and cancel', async () => {
    const s = await loginAs('FARMER');
    const d = await call(s, 'POST', '/drafts', { kind: 'SALE_LISTING', patch: SALE });
    const id = d.body.draft.id;
    await call(s, 'PATCH', `/drafts/${id}`, { expectedVersion: 1, patch: { province: 'Nakhon Sawan' } });
    for (const [p, b] of [
      [`/drafts/${id}`, { expectedVersion: 1, patch: { province: 'Z' } }],
      [`/drafts/${id}/publish`, { expectedVersion: 1 }],
      [`/drafts/${id}/cancel`, { expectedVersion: 1 }],
    ] as const) {
      const r = await call(s, p.endsWith(id) ? 'PATCH' : 'POST', p, b);
      expect(r.status, p).toBe(409);
      expect(r.body.error).toMatchObject({ code: 'STALE_VERSION', details: { current_version: 2 } });
    }
    expect((await call(s, 'GET', '/listings')).body).toEqual([]); // nothing was created
  });

  it('publishes idempotently: same version twice yields one listing; the Idempotency-Key replays', async () => {
    const s = await loginAs('FARMER');
    const d = await call(s, 'POST', '/drafts', { kind: 'SALE_LISTING', patch: SALE });
    const id = d.body.draft.id;
    const url = `/drafts/${id}/publish`;
    const a = await call(s, 'POST', url, { expectedVersion: 1 }, { 'idempotency-key': 'key-route-1' });
    const b = await call(s, 'POST', url, { expectedVersion: 1 }, { 'idempotency-key': 'key-route-1' });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ draft_id: id, entity_type: 'LISTING', replayed: false });
    expect(b.body).toMatchObject({ entity_id: a.body.entity_id, replayed: true });
    const c = await call(s, 'POST', url, { expectedVersion: 1 }); // no key: natural idempotence
    expect(c.body.entity_id).toBe(a.body.entity_id);
    const mismatch = await call(s, 'POST', url, { expectedVersion: 2 }, { 'idempotency-key': 'key-route-1' });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('IDEMPOTENCY_MISMATCH');
    expect((await call(s, 'POST', url, { expectedVersion: 1 }, { 'idempotency-key': 'bad key' })).status).toBe(422);
    const list = await call(s, 'GET', '/listings');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: a.body.entity_id, status: 'PUBLISHED', total_qty_kg: '5000.000', version: 1 });
  });

  it('cancels a draft, and refuses to patch it afterwards', async () => {
    const s = await loginAs('FARMER');
    const d = await call(s, 'POST', '/drafts', { kind: 'SALE_LISTING' });
    const c = await call(s, 'POST', `/drafts/${d.body.draft.id}/cancel`, { expectedVersion: 1 });
    expect(c.status).toBe(200);
    expect(c.body.draft.status).toBe('CANCELLED');
    const p = await call(s, 'PATCH', `/drafts/${d.body.draft.id}`, { expectedVersion: 2, patch: { province: 'X' } });
    expect(p.status).toBe(409);
    expect(p.body.error.code).toBe('INVALID_STATE');
  });

  it('pauses, opens, closes and cancels a listing with expectedVersion', async () => {
    const s = await loginAs('FARMER');
    const { published } = await publishedSale(s);
    const url = `/listings/${published.entity_id}`;
    const stale = await call(s, 'POST', `${url}/pause`, { expectedVersion: 9 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_VERSION');
    expect((await call(s, 'POST', `${url}/pause`, {})).status).toBe(422);
    const paused = await call(s, 'POST', `${url}/pause`, { expectedVersion: 1 });
    expect(paused.body).toMatchObject({ status: 'PAUSED', version: 2 });
    const open = await call(s, 'POST', `${url}/open`, { expectedVersion: 2 });
    expect(open.body).toMatchObject({ status: 'PUBLISHED', version: 3 });
    const closed = await call(s, 'POST', `${url}/close`, { expectedVersion: 3 });
    expect(closed.body.status).toBe('CLOSED');
    const again = await call(s, 'POST', `${url}/cancel`, { expectedVersion: 4 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
  });

  it('serves purchase demands to a factory and denies them to a farmer', async () => {
    const factory = await loginAs('BUYER_FACTORY');
    const farmer = await loginAs('FARMER');
    const d = await call(factory, 'POST', '/drafts', { kind: 'PURCHASE_DEMAND', patch: DEMAND });
    expect(d.status).toBe(201);
    const p = await call(factory, 'POST', `/drafts/${d.body.draft.id}/publish`, { expectedVersion: d.body.draft.version });
    expect(p.body.entity_type).toBe('DEMAND');
    const got = await call(factory, 'GET', `/purchase-demands/${p.body.entity_id}`);
    expect(got.body).toMatchObject({ status: 'PUBLISHED', target_qty_kg: '20000.000' });
    expect((await call(factory, 'POST', `/purchase-demands/${p.body.entity_id}/pause`, { expectedVersion: 1 })).body.status).toBe('PAUSED');
    const denied = await call(farmer, 'GET', '/purchase-demands');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    expect((await call(farmer, 'POST', '/drafts', { kind: 'PURCHASE_DEMAND', patch: DEMAND })).status).toBe(403);
  });

  it('serves baling requests to a farmer and baling services to a baler', async () => {
    const farmer = await loginAs('FARMER');
    const baler = await loginAs('BALER');
    const req = await call(farmer, 'POST', '/drafts', { kind: 'BALING_REQUEST' });
    expect(req.status).toBe(201);
    expect((await call(farmer, 'GET', '/baling-requests')).status).toBe(200);
    expect((await call(farmer, 'GET', '/baling-services')).status).toBe(403);
    expect((await call(baler, 'GET', '/baling-services')).body).toEqual([]);
    expect((await call(baler, 'POST', '/drafts', { kind: 'BALING_REQUEST' })).status).toBe(403);
  });
});
