// REST routes for offers and agreements against real Postgres (task 8.7). Synthetic data only.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvSchema } from '../src/config/env.js';
import { createApp } from '../src/http/app.js';
import { mountAgreementRoutes } from '../src/http/agreement-routes.js';
import { mountOfferRoutes } from '../src/http/offer-routes.js';
import { createLogger } from '../src/logger.js';
import { createAuthService, createDemoOrgUser, LoginRateLimiter } from '../src/services/auth/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing } from './factories.js';

const ORIGIN = 'http://localhost:3000';
const PW = 'synthetic-Passw0rd-for-tests';
interface Session { cookie: string; csrf: string; orgId: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Json { status: number; body: any }

describe.skipIf(!testDatabaseUrl)('offer and agreement routes (real Postgres)', () => {
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
      mountRoutes: (a) => { mountOfferRoutes(a, { pool: db.pool }); mountAgreementRoutes(a, { pool: db.pool }); },
    });
    server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    await db?.close();
  });

  async function loginAs(kind: 'FARMER' | 'BUYER_FACTORY'): Promise<Session> {
    const email = `offer-route-${++seq}@example.invalid`;
    const { org } = await createDemoOrgUser(db.pool, { kind, orgName: `synthetic-org-${seq}`, email, password: PW });
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password: PW }),
    });
    expect(res.status).toBe(204);
    const cookie = `agrimatch_sid=${/agrimatch_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`;
    const me = (await (await fetch(`${base}/me`, { headers: { cookie } })).json()) as { csrf_secret: string };
    return { cookie, csrf: me.csrf_secret, orgId: org.id };
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
  /** A farmer with a listing, a factory with a demand, and an outsider organization. */
  async function market(over: { listingQty?: string; pending?: boolean } = {}) {
    const farmer = await loginAs('FARMER');
    const factory = await loginAs('BUYER_FACTORY');
    const outsider = await loginAs('FARMER');
    const listing = await makeListing(db.pool, farmer.orgId, {
      ...(over.listingQty ? { qty: over.listingQty } : {}), ...(over.pending ? { pending_material: true, expected_ready_at: new Date(Date.now() + 7 * 86_400_000) } : {}),
    });
    const demand = await makeDemand(db.pool, factory.orgId);
    return { farmer, factory, outsider, listing, demand };
  }
  type Market = Awaited<ReturnType<typeof market>>;
  const terms = (m: Market, qtyKg = '1000') => ({
    kind: 'PURCHASE', listingId: m.listing.id, demandId: m.demand.id, qtyKg, unitPriceThb: '1.5', priceUnit: 'KG',
  });
  async function send(m: Market, qtyKg = '1000') {
    const r = await call(m.factory, 'POST', '/offers', terms(m, qtyKg));
    expect(r.status).toBe(201);
    return r.body.offer as { id: string; version: number };
  }

  it('creates an offer with string decimals, lists it for both parties and reads it by id', async () => {
    const m = await market();
    const r = await call(m.factory, 'POST', '/offers', terms(m), { 'idempotency-key': 'create-1' });
    expect(r.status).toBe(201);
    expect(r.body.offer).toMatchObject({
      status: 'PENDING', qty_kg: '1000.000', unit_price_thb: '1.5000', total_amount_thb: '1500.00', direction: 'sent',
      from_org_id: m.factory.orgId, to_org_id: m.farmer.orgId,
    });
    expect(r.body.offer.idempotency_key).toBeUndefined();
    const id = r.body.offer.id;
    // replay returns the same offer and does not create another
    const again = await call(m.factory, 'POST', '/offers', terms(m), { 'idempotency-key': 'create-1' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ replayed: true, offer: { id } });
    const sent = await call(m.factory, 'GET', '/offers?direction=sent');
    expect(sent.body.map((o: { id: string }) => o.id)).toEqual([id]);
    const received = await call(m.farmer, 'GET', '/offers?direction=received&status=PENDING');
    expect(received.body).toHaveLength(1);
    expect(received.body[0]).toMatchObject({ id, direction: 'received' });
    expect((await call(m.farmer, 'GET', `/offers/${id}`)).body.id).toBe(id);
    expect((await call(m.farmer, 'GET', '/offers?status=BOGUS')).status).toBe(422);
  });

  it('rejects an invalid body with 422 and lists nothing for an unrelated organization', async () => {
    const m = await market();
    const bad = await call(m.factory, 'POST', '/offers', { ...terms(m), qtyKg: 1000 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('VALIDATION');
    expect((await call(m.factory, 'POST', '/offers', { ...terms(m), extra: 1 })).status).toBe(422);
    await send(m);
    expect((await call(m.outsider, 'GET', '/offers')).body).toEqual([]);
  });

  it('the receiver accepts: agreement for both parties only, Idempotency-Key replay returns the same agreement', async () => {
    const m = await market();
    const o = await send(m);
    expect((await call(m.factory, 'POST', `/offers/${o.id}/accept`, {})).status).toBe(404); // sender cannot accept
    const a = await call(m.farmer, 'POST', `/offers/${o.id}/accept`, {}, { 'idempotency-key': 'acc-1' });
    expect(a.status).toBe(200);
    expect(a.body.replayed).toBe(false);
    expect(a.body.offer.status).toBe('ACCEPTED');
    expect(a.body.agreement).toMatchObject({
      status: 'PURCHASE_CONFIRMED', qty_kg: '1000.000', seller_org_id: m.farmer.orgId, buyer_org_id: m.factory.orgId,
    });
    expect(JSON.stringify(a.body)).not.toMatch(/paid|delivered|payment/i);
    const replay = await call(m.farmer, 'POST', `/offers/${o.id}/accept`, {}, { 'idempotency-key': 'acc-1' });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replayed: true, agreement: { id: a.body.agreement.id } });
    const agId = a.body.agreement.id;
    for (const s of [m.farmer, m.factory]) {
      expect((await call(s, 'GET', '/agreements')).body.map((x: { id: string }) => x.id)).toEqual([agId]);
      expect((await call(s, 'GET', `/agreements/${agId}`)).body.id).toBe(agId);
    }
    expect((await call(m.outsider, 'GET', '/agreements')).body).toEqual([]);
    expect((await call(m.outsider, 'GET', `/agreements/${agId}`)).status).toBe(404);
    expect((await call(m.outsider, 'GET', '/agreements/not-a-uuid')).status).toBe(404);
  });

  it('insufficient quantity is 409 and the offer stays PENDING', async () => {
    const m = await market({ listingQty: '1000' });
    const first = await send(m, '600');
    const second = await send(m, '600');
    expect((await call(m.farmer, 'POST', `/offers/${first.id}/accept`, {})).status).toBe(200);
    const r = await call(m.farmer, 'POST', `/offers/${second.id}/accept`, {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INSUFFICIENT_QUANTITY');
    expect((await call(m.farmer, 'GET', `/offers/${second.id}`)).body.status).toBe('PENDING');
    expect((await call(m.farmer, 'GET', '/agreements')).body).toHaveLength(1);
  });

  it('reject by the receiver and withdraw by the sender; each only from PENDING', async () => {
    const m = await market();
    const a = await send(m);
    expect((await call(m.factory, 'POST', `/offers/${a.id}/reject`, {})).status).toBe(404);
    const rej = await call(m.farmer, 'POST', `/offers/${a.id}/reject`, { expectedVersion: a.version });
    expect(rej.status).toBe(200);
    expect(rej.body.offer.status).toBe('REJECTED');
    expect((await call(m.farmer, 'POST', `/offers/${a.id}/reject`, {})).body.error.code).toBe('INVALID_STATE');
    const b = await send(m);
    expect((await call(m.farmer, 'POST', `/offers/${b.id}/withdraw`, {})).status).toBe(404);
    const w = await call(m.factory, 'POST', `/offers/${b.id}/withdraw`, {});
    expect(w.status).toBe(200);
    expect(w.body.offer.status).toBe('WITHDRAWN');
    expect((await call(m.farmer, 'POST', `/offers/${b.id}/accept`, {})).status).toBe(409);
  });

  it('edit withdraws the old offer and creates a new PENDING one; a stale version is 409', async () => {
    const m = await market();
    const o = await send(m);
    const stale = await call(m.factory, 'POST', `/offers/${o.id}/edit`, { expectedVersion: o.version + 5, changes: { qtyKg: '500' } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_VERSION');
    const e = await call(m.factory, 'POST', `/offers/${o.id}/edit`, { expectedVersion: o.version, changes: { qtyKg: '500' } });
    expect(e.status).toBe(201);
    expect(e.body.replaced).toMatchObject({ id: o.id, status: 'WITHDRAWN' });
    expect(e.body.offer).toMatchObject({ status: 'PENDING', qty_kg: '500.000', supersedes_offer_id: o.id });
    expect((await call(m.farmer, 'POST', `/offers/${o.id}/edit`, { expectedVersion: 1, changes: { qtyKg: '1' } })).status).toBe(404);
    expect((await call(m.factory, 'POST', `/offers/${o.id}/edit`, { expectedVersion: 1, changes: {} })).status).toBe(422);
  });

  it('resale material that is not yet received needs ackPendingMaterial', async () => {
    const m = await market({ pending: true });
    const no = await call(m.factory, 'POST', '/offers', terms(m));
    expect(no.status).toBe(422);
    expect(no.body.error.fields[0].path).toBe('ackPendingMaterial');
    const yes = await call(m.factory, 'POST', '/offers', { ...terms(m), ackPendingMaterial: true });
    expect(yes.status).toBe(201);
    expect(yes.body.offer.ack_pending_material).toBe(true);
    const acc = await call(m.farmer, 'POST', `/offers/${yes.body.offer.id}/accept`, {});
    expect(acc.status).toBe(200);
  });

  it('cross-organization ids look missing (404), writes without CSRF are 403, no session is 401', async () => {
    const m = await market();
    const o = await send(m);
    expect((await call(m.outsider, 'GET', `/offers/${o.id}`)).status).toBe(404);
    for (const action of ['accept', 'reject', 'withdraw']) {
      expect((await call(m.outsider, 'POST', `/offers/${o.id}/${action}`, {})).status).toBe(404);
    }
    expect((await call(m.outsider, 'POST', `/offers/${o.id}/edit`, { expectedVersion: 1, changes: { qtyKg: '1' } })).status).toBe(404);
    const noCsrf = await fetch(`${base}/offers/${o.id}/accept`, {
      method: 'POST', headers: { cookie: m.farmer.cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: '{}',
    });
    expect(noCsrf.status).toBe(403);
    const createNoCsrf = await fetch(`${base}/offers`, {
      method: 'POST', headers: { cookie: m.factory.cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(terms(m)),
    });
    expect(createNoCsrf.status).toBe(403);
    expect((await call(m.farmer, 'GET', `/offers/${o.id}`)).body.status).toBe('PENDING');
    for (const [method, path] of [['GET', '/offers'], ['GET', `/offers/${o.id}`], ['GET', '/agreements'], ['POST', '/offers'], ['POST', `/offers/${o.id}/accept`]] as const) {
      expect((await call(null, method, path, method === 'POST' ? {} : undefined)).status).toBe(401);
    }
  });
});
