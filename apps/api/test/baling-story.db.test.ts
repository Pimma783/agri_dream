// Story 2 (baling service) end to end over HTTP against real Postgres (task 12.1). Synthetic data only.
// Publish from drafts, match route 3, offer from either side, one acceptance, SERVICE_CONFIRMED, no ownership or quantity change.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvSchema } from '../src/config/env.js';
import { createApp } from '../src/http/app.js';
import { mountAgreementRoutes } from '../src/http/agreement-routes.js';
import { mountMatchRoutes } from '../src/http/match-routes.js';
import { mountOfferRoutes } from '../src/http/offer-routes.js';
import { mountResourceRoutes } from '../src/http/resource-routes.js';
import { createLogger } from '../src/logger.js';
import { lineIdentities } from '../src/repos/index.js';
import { createAuthService, createDemoOrgUser, LoginRateLimiter } from '../src/services/auth/index.js';
import { createMatchingService } from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';

const ORIGIN = 'http://localhost:3000';
const PW = 'synthetic-Passw0rd-for-tests';
const NOW = new Date('2026-11-18T00:00:00Z');
const FARMER_NAME = 'synthetic-baling-farmer-private-name';
const SERVICE_PATCH = {
  material_types: ['RICE_STRAW'], service_mode: 'BOTH', price_mode: 'FIXED', price: { value: '0.5', unit: 'kg' },
  province: 'Uttaradit', service_provinces: ['Uttaradit'], min_quantity: { value: '100', unit: 'kg' },
};
const REQUEST_PATCH = { material_type: 'RICE_STRAW', quantity: { value: '5', unit: 'ton' }, requested_mode: 'ON_SITE', province: 'Uttaradit' };

interface Session { cookie: string; csrf: string; orgId: string; userId: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Json { status: number; body: any }

describe.skipIf(!testDatabaseUrl)('baling service story (real Postgres, HTTP)', () => {
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
        mountResourceRoutes(a, ctx); mountMatchRoutes(a, ctx); mountOfferRoutes(a, ctx); mountAgreementRoutes(a, ctx);
      },
    });
    server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    await db?.close();
  });

  async function loginAs(kind: 'FARMER' | 'BALER', orgName = `synthetic-org-${seq + 1}`): Promise<Session> {
    const email = `baling-story-${++seq}-${Date.now()}@example.invalid`;
    const { org, user } = await createDemoOrgUser(db.pool, { kind, orgName, email, password: PW });
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password: PW }),
    });
    expect(res.status).toBe(204);
    const cookie = `agrimatch_sid=${/agrimatch_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`;
    const me = (await (await fetch(`${base}/me`, { headers: { cookie } })).json()) as { csrf_secret: string };
    const channel = kind === 'FARMER' ? 'farmer' : 'baler';
    const ident = await lineIdentities.ensure(db.pool, channel, `U-synthetic-baling-${org.id}`);
    await lineIdentities.link(db.pool, ident.id, user.id, org.id);
    return { cookie, csrf: me.csrf_secret, orgId: org.id, userId: user.id };
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
  const count = async (sql: string, params: unknown[] = []) => Number((await db.pool.query(sql, params)).rows[0].n);

  /** A baler publishes a service and a farmer a request, both from the Dashboard drafts, then matching runs. */
  async function market() {
    const baler = await loginAs('BALER');
    const farmer = await loginAs('FARMER', FARMER_NAME);
    const outsider = await loginAs('FARMER');
    const sd = await call(baler, 'POST', '/drafts', { kind: 'BALING_SERVICE', patch: SERVICE_PATCH });
    expect(sd.status).toBe(201);
    const sp = await call(baler, 'POST', `/drafts/${sd.body.draft.id}/publish`, { expectedVersion: sd.body.draft.version });
    expect(sp.status).toBe(200);
    expect(sp.body.entity_type).toBe('BALING_SERVICE');
    const rd = await call(farmer, 'POST', '/drafts', { kind: 'BALING_REQUEST', patch: REQUEST_PATCH });
    expect(rd.status).toBe(201);
    const rp = await call(farmer, 'POST', `/drafts/${rd.body.draft.id}/publish`, { expectedVersion: rd.body.draft.version });
    expect(rp.status).toBe(200);
    expect(rp.body.entity_type).toBe('BALING_REQUEST');
    const matching = createMatchingService({ pool: db.pool, now: () => NOW });
    for (const [t, id] of [['BALING_SERVICE', sp.body.entity_id], ['BALING_REQUEST', rp.body.entity_id]] as const) {
      expect((await matching.recompute({ entity_type: t, entity_id: id, version: 1 })).ok).toBe(true);
    }
    return { baler, farmer, outsider, serviceId: sp.body.entity_id as string, requestId: rp.body.entity_id as string };
  }
  type Market = Awaited<ReturnType<typeof market>>;
  const offerBody = (m: Market, extra: Record<string, unknown> = {}) => ({
    kind: 'BALING_SERVICE', balingServiceId: m.serviceId, balingRequestId: m.requestId, qtyKg: '4000', unitPriceThb: '0.5', priceUnit: 'KG', ...extra,
  });

  it('the farmer finds the baler through route 3 matches; the baler sees the request without the farmer identity', async () => {
    const m = await market();
    const f = await call(m.farmer, 'GET', '/matches?route=3');
    expect(f.status).toBe(200);
    const fm = f.body.find((x: { counterparty: { entity_id: string } }) => x.counterparty.entity_id === m.serviceId);
    expect(fm).toMatchObject({ route: 3, own_entity_id: m.requestId, counterparty: { entity_type: 'BALING_SERVICE' } });
    const b = await call(m.baler, 'GET', '/matches?route=3');
    const bm = b.body.find((x: { counterparty: { entity_id: string } }) => x.counterparty.entity_id === m.requestId);
    expect(bm).toMatchObject({ route: 3, own_entity_id: m.serviceId, counterparty: { entity_type: 'BALING_REQUEST' } });
    const text = JSON.stringify(b.body);
    for (const secret of [FARMER_NAME, m.farmer.orgId, m.farmer.userId]) expect(text).not.toContain(secret);
    expect((await call(m.outsider, 'GET', '/matches?route=3')).body).toEqual([]);
  });

  it('baler offers from a match, the farmer accepts once: SERVICE_CONFIRMED, farmer keeps ownership, no stock or quantity changes', async () => {
    const m = await market();
    const matchId = (await call(m.baler, 'GET', '/matches?route=3')).body
      .find((x: { counterparty: { entity_id: string } }) => x.counterparty.entity_id === m.requestId).id as string;
    const created = await call(m.baler, 'POST', '/offers', { kind: 'BALING_SERVICE', matchId, qtyKg: '4000', unitPriceThb: '0.5', priceUnit: 'KG' });
    expect(created.status).toBe(201);
    const o = created.body.offer;
    expect(o).toMatchObject({ kind: 'BALING_SERVICE', status: 'PENDING', from_org_id: m.baler.orgId, to_org_id: m.farmer.orgId, total_amount_thb: '2000.00' });
    expect((await call(m.baler, 'POST', `/offers/${o.id}/accept`, {})).status).toBe(404); // the sender cannot accept
    expect((await call(m.outsider, 'POST', `/offers/${o.id}/accept`, {})).status).toBe(404);

    const ledgerBefore = await count('SELECT count(*) AS n FROM quantity_ledger');
    const listingsBefore = await count('SELECT count(*) AS n FROM material_listings');
    const a = await call(m.farmer, 'POST', `/offers/${o.id}/accept`, {}, { 'idempotency-key': 'baling-acc-1' });
    expect(a.status).toBe(200);
    expect(a.body.offer.status).toBe('ACCEPTED');
    expect(a.body.agreement).toMatchObject({
      kind: 'BALING_SERVICE', status: 'SERVICE_CONFIRMED', seller_org_id: m.baler.orgId, buyer_org_id: m.farmer.orgId,
      baling_service_id: m.serviceId, baling_request_id: m.requestId, listing_id: null, demand_id: null, qty_kg: '4000.000', resale_reserved_kg: '0.000',
    });
    expect(JSON.stringify(a.body)).not.toMatch(/PURCHASE|paid|delivered|payment|BALED|อัดเสร็จ/i);

    // replay and a repeat accept return the same agreement, nothing new is written
    const replay = await call(m.farmer, 'POST', `/offers/${o.id}/accept`, {}, { 'idempotency-key': 'baling-acc-1' });
    expect(replay.body).toMatchObject({ replayed: true, agreement: { id: a.body.agreement.id } });
    const again = await call(m.farmer, 'POST', `/offers/${o.id}/accept`, {});
    expect(again.status).toBe(200);
    expect(again.body.agreement.id).toBe(a.body.agreement.id);
    expect(await count('SELECT count(*) AS n FROM agreements WHERE offer_id = $1', [o.id])).toBe(1);

    // no stock for the baler, no quantity or ledger writes, the request keeps its quantity and status
    expect(await count('SELECT count(*) AS n FROM quantity_ledger')).toBe(ledgerBefore);
    expect(await count('SELECT count(*) AS n FROM material_listings')).toBe(listingsBefore);
    expect(await count('SELECT count(*) AS n FROM material_listings WHERE org_id = $1', [m.baler.orgId])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM agreements WHERE id = $1 AND source_agreement_id IS NOT NULL', [a.body.agreement.id])).toBe(0);
    const req = await call(m.farmer, 'GET', `/baling-requests/${m.requestId}`);
    expect(req.body).toMatchObject({ status: 'PUBLISHED', qty_kg: '5000.000', version: 1 });
    expect((await call(m.baler, 'GET', `/baling-services/${m.serviceId}`)).body).toMatchObject({ status: 'PUBLISHED', version: 1 });

    // both parties see the same agreement, kept apart from purchases; others see nothing
    const id = a.body.agreement.id;
    for (const s of [m.farmer, m.baler]) {
      expect((await call(s, 'GET', '/agreements?kind=BALING_SERVICE')).body.map((x: { id: string }) => x.id)).toEqual([id]);
      expect((await call(s, 'GET', '/agreements?kind=PURCHASE')).body).toEqual([]);
      expect((await call(s, 'GET', '/agreements')).body.map((x: { id: string }) => x.id)).toEqual([id]);
      expect((await call(s, 'GET', `/agreements/${id}`)).body.kind).toBe('BALING_SERVICE');
    }
    expect((await call(m.outsider, 'GET', '/agreements?kind=BALING_SERVICE')).body).toEqual([]);
    expect((await call(m.outsider, 'GET', `/agreements/${id}`)).status).toBe(404);
    expect((await call(m.farmer, 'GET', '/agreements?kind=BOGUS')).status).toBe(422);
    expect((await call(m.farmer, 'GET', '/agreements?org=x')).status).toBe(422);

    // both parties were told, with the baling wording and no completion claim
    const box = (await db.pool.query<{ channel: string; message: unknown }>(
      `SELECT channel, message FROM notification_outbox WHERE related_id = $1 AND dedupe_key LIKE '%:accepted:%' ORDER BY channel`, [o.id],
    )).rows;
    expect(box.map((r) => r.channel)).toEqual(['baler', 'farmer']);
    for (const r of box) {
      const text = JSON.stringify(r.message);
      expect(text).toContain('ยืนยันบริการอัด — ไม่ใช่หลักฐานว่าอัดเสร็จแล้ว');
      expect(text).not.toContain('ข้อตกลงยืนยันแล้ว นี่คือการยืนยันข้อตกลง');
    }
  });

  it('the farmer can start the offer; the baler accepts once', async () => {
    const m = await market();
    const created = await call(m.farmer, 'POST', '/offers', offerBody(m, { qtyKg: '2500' }));
    expect(created.status).toBe(201);
    expect(created.body.offer).toMatchObject({ from_org_id: m.farmer.orgId, to_org_id: m.baler.orgId });
    const a = await call(m.baler, 'POST', `/offers/${created.body.offer.id}/accept`, {});
    expect(a.status).toBe(200);
    expect(a.body.agreement).toMatchObject({ kind: 'BALING_SERVICE', status: 'SERVICE_CONFIRMED', seller_org_id: m.baler.orgId, buyer_org_id: m.farmer.orgId, qty_kg: '2500.000' });
    // the same request can be served by a further offer: baling does not consume quantity
    const second = await call(m.baler, 'POST', '/offers', offerBody(m, { qtyKg: '4000' }));
    expect(second.status).toBe(201);
  });

  it('validation and state: a purchase offer on a baling match, an oversize quantity and a paused service are refused', async () => {
    const m = await market();
    const matchId = (await call(m.baler, 'GET', '/matches?route=3')).body[0].id as string;
    const wrongKind = await call(m.baler, 'POST', '/offers', { kind: 'PURCHASE', matchId, qtyKg: '100' });
    expect(wrongKind.status).toBe(422);
    const over = await call(m.baler, 'POST', '/offers', offerBody(m, { qtyKg: '6000' }));
    expect(over.status).toBe(422);
    expect(over.body.error.fields[0].path).toBe('qtyKg');
    const o = (await call(m.baler, 'POST', '/offers', offerBody(m))).body.offer;
    expect((await call(m.baler, 'POST', `/baling-services/${m.serviceId}/pause`, { expectedVersion: 1 })).status).toBe(200);
    const refused = await call(m.farmer, 'POST', `/offers/${o.id}/accept`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('INVALID_STATE');
    expect((await call(m.farmer, 'GET', `/offers/${o.id}`)).body.status).toBe('PENDING');
    expect((await call(m.farmer, 'GET', '/agreements')).body).toEqual([]);
  });
});
