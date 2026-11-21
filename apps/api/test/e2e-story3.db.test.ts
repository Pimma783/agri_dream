// End-to-end story 3 (resale) against real Postgres and the real Express app (task 16.5). Synthetic data only.
// Demo split: the FARMER works in LINE (signed webhook -> line_event job -> farmer handler, FakeLineClient + MockBedrock);
// the BALER and the BUYER_FACTORY use the Dashboard REST API (session cookie + CSRF).
// Not covered here: the LINE message texts themselves (line-farmer-handler.db.test.ts) and the resale pages (task 16.4).
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLineClient } from '../src/adapters/line/index.js';
import { MockBedrock } from '../src/adapters/bedrock/test-support.js';
import { composeAssistant } from '../src/assistant/index.js';
import { signBody } from '../src/channels/line/signature.js';
import { createBalerHandler, createFactoryHandler, createFarmerHandler, createLineGateway } from '../src/channels/index.js';
import { EnvSchema } from '../src/config/env.js';
import { createApp } from '../src/http/app.js';
import { mountAgreementRoutes } from '../src/http/agreement-routes.js';
import { mountMatchRoutes } from '../src/http/match-routes.js';
import { mountOfferRoutes } from '../src/http/offer-routes.js';
import { mountResaleRoutes } from '../src/http/resale-routes.js';
import { mountResourceRoutes } from '../src/http/resource-routes.js';
import { HandlerRegistry, JobRunner, registerLineEvent } from '../src/jobs/index.js';
import { registerRecomputeMatches } from '../src/jobs/recompute-matches.js';
import { createLogger } from '../src/logger.js';
import { createAuthService, createDemoOrgUser, LoginRateLimiter } from '../src/services/auth/index.js';
import {
  createConversationService, createDraftService, createJobQueue, createLineEventStore, createMatchingService,
  createMatchReadService, createOfferService, createWebhookService,
} from '../src/services/index.js';
import { createLineIdentityService } from '../src/services/identity/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { channels, SECRETS } from './webhook-helper.js';

const ORIGIN = 'http://localhost:3000';
const PW = 'synthetic-Passw0rd-for-tests';
const FARMER_LINE_ID = 'U-synthetic-story3-farmer';
const FARMER_GEO = { lat: 17.62, lng: 100.1 };

interface Session { cookie: string; csrf: string; orgId: string; userId: string; name: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Json { status: number; body: any }

describe.skipIf(!testDatabaseUrl)('story 3 resale: farmer in LINE, baler and factory on the Dashboard (real Postgres, real app)', () => {
  let db: TestDb;
  let server: Server;
  let base: string;
  let runner: JobRunner;
  let seq = 0;
  let evt = 0;

  beforeAll(async () => {
    db = await createTestDb();
    const pool = db.pool;
    const drafts = createDraftService({ pool });
    const conversations = createConversationService({ pool });
    const identity = createLineIdentityService({ pool, config: { linkCodeTtlMs: 600_000 } });
    const bedrock = new MockBedrock([{
      type: 'json',
      value: {
        intent: 'SELL_MATERIAL', reply_text: 'รับทราบ',
        draft_patch: {
          kind: 'SALE_LISTING',
          fields: { material_type: 'RICE_STRAW', quantity: { value: '5', unit: 'ton' }, price_mode: 'NEGOTIABLE', province: 'Uttaradit' },
        },
      },
    }]);
    const gateway = createLineGateway({
      events: createLineEventStore({ pool }),
      line: new FakeLineClient(),
      handlers: {
        farmer: createFarmerHandler({
          identity, drafts, conversations, offers: createOfferService({ pool }),
          assistant: composeAssistant({
            env: { ENABLE_REAL_BEDROCK: true, BEDROCK_MODEL_ID: 'anthropic.claude-sonnet-5', ASSISTANT_HISTORY_MESSAGES: 12, AI_MODE: 'enabled' },
            drafts, conversations, matches: createMatchReadService({ pool }), bedrock,
          }),
        }),
        baler: createBalerHandler({ identity, offers: createOfferService({ pool }), matches: createMatchReadService({ pool }), webOrigin: 'http://localhost:3000' }),
        factory: createFactoryHandler({ identity, offers: createOfferService({ pool }), matches: createMatchReadService({ pool }), webOrigin: 'http://localhost:3000' }),
      },
    });
    const handlers = new HandlerRegistry();
    registerLineEvent(handlers, { gateway });
    registerRecomputeMatches(handlers, { matching: createMatchingService({ pool, now: () => new Date('2026-11-18T00:00:00Z') }) });
    runner = new JobRunner({ queue: createJobQueue(pool), handlers, batchSize: 50 });

    const auth = createAuthService({
      pool, config: { idleMs: 3_600_000, absoluteMs: 18_000_000 }, limiter: new LoginRateLimiter({ maxAttempts: 1000, windowMs: 60_000 }),
    });
    const env = EnvSchema.parse({ NODE_ENV: 'test', WEB_ORIGIN: ORIGIN });
    const app = createApp({
      env, logger: createLogger('silent'), auth, webhooks: { channels, service: createWebhookService({ pool }) },
      mountRoutes: (a) => {
        const ctx = { pool };
        mountResourceRoutes(a, ctx); mountMatchRoutes(a, ctx); mountOfferRoutes(a, ctx); mountAgreementRoutes(a, ctx); mountResaleRoutes(a, ctx);
      },
    });
    server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    await db?.close();
  });

  // ---- helpers ----
  /** Runs queued jobs (line_event, recompute_matches) until none is due. */
  async function drain(): Promise<void> {
    for (let i = 0; i < 20; i++) if ((await runner.tick()).claimed === 0) return;
    throw new Error('jobs did not settle');
  }
  /** One signed LINE webhook delivery on the farmer channel, then the worker. */
  async function farmerEvent(event: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify({
      destination: 'Usynthetic',
      events: [{ webhookEventId: `story3-${++evt}`, timestamp: Date.now(), source: { type: 'user', userId: FARMER_LINE_ID }, replyToken: 'rt', ...event }],
    });
    const res = await fetch(`${base}/webhooks/line/farmer`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': signBody(SECRETS.farmer, Buffer.from(body)) }, body,
    });
    expect(res.status).toBe(200);
    await drain();
  }
  async function loginAs(kind: 'BALER' | 'BUYER_FACTORY'): Promise<Session> {
    const email = `story3-${++seq}-${Date.now()}@example.invalid`;
    const orgName = `synthetic-story3-${kind.toLowerCase()}`;
    const { org, user } = await createDemoOrgUser(db.pool, { kind, orgName, email, password: PW });
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password: PW }),
    });
    expect(res.status).toBe(204);
    const cookie = `agrimatch_sid=${/agrimatch_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`;
    const me = (await (await fetch(`${base}/me`, { headers: { cookie } })).json()) as { csrf_secret: string };
    return { cookie, csrf: me.csrf_secret, orgId: org.id, userId: user.id, name: orgName };
  }
  async function call(s: Session, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Json> {
    const headers: Record<string, string> = { ...extra, cookie: s.cookie };
    if (method !== 'GET') { headers.origin = ORIGIN; headers['x-csrf-token'] = s.csrf; }
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> => (await db.pool.query(sql, params)).rows[0] as T;
  const reserved = async (agreementId: string) => (await one<{ r: string }>('SELECT resale_reserved_kg::text AS r FROM agreements WHERE id = $1', [agreementId])).r;
  /** Creates a draft, completes it with `patch` and publishes it; returns the new entity id. */
  async function publishDraft(s: Session, kind: string, patch: Record<string, unknown>): Promise<string> {
    const d = await call(s, 'POST', '/drafts', { kind, patch });
    expect(d.status).toBe(201);
    expect(d.body.complete).toBe(true);
    const p = await call(s, 'POST', `/drafts/${d.body.draft.id}/publish`, { expectedVersion: d.body.draft.version });
    expect(p.status).toBe(200);
    return p.body.entity_id as string;
  }

  it('runs the whole chain: farmer sale -> baler purchase -> resale draft -> publish -> factory offer with ack -> baler accepts', async () => {
    const baler = await loginAs('BALER');
    const factory = await loginAs('BUYER_FACTORY');

    // ---- buyers publish their demands on the Dashboard ----
    await publishDraft(baler, 'PURCHASE_DEMAND', {
      accepted_materials: ['RICE_STRAW'], target_quantity: { value: '20', unit: 'ton' }, price_mode: 'FIXED', price: { value: '2', unit: 'kg' },
      province: 'Uttaradit', lat: '17.720000', lng: '100.100000', radius_km: '50',
    });
    const factoryDemandId = await publishDraft(factory, 'PURCHASE_DEMAND', {
      accepted_materials: ['RICE_STRAW'], target_quantity: { value: '10', unit: 'ton' }, price_mode: 'FIXED', price: { value: '2.5', unit: 'kg' },
      province: 'Uttaradit', lat: '17.800000', lng: '100.200000', radius_km: '50', accepts_pending_material: true,
    });

    // ---- FARMER, in LINE: follow, text turn (MockBedrock fills the draft), location, confirm postback ----
    await farmerEvent({ type: 'follow' });
    const ident = await one<{ org_id: string; user_id: string }>(
      `SELECT org_id, user_id FROM line_identities WHERE channel = 'farmer' AND line_user_id = $1`, [FARMER_LINE_ID]);
    const farmerOrgName = (await one<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [ident.org_id])).name;
    await farmerEvent({ type: 'message', message: { type: 'text', text: 'ขายฟางข้าว 5 ตัน' } });
    await farmerEvent({ type: 'message', message: { type: 'location', latitude: FARMER_GEO.lat, longitude: FARMER_GEO.lng } });
    const fd = await one<{ id: string; version: number; published_entity_id: string | null }>(
      'SELECT id, version, published_entity_id FROM drafts WHERE org_id = $1', [ident.org_id]);
    expect(fd.published_entity_id).toBeNull();
    expect(Number((await one<{ n: string }>('SELECT count(*) AS n FROM material_listings WHERE org_id = $1', [ident.org_id])).n)).toBe(0);
    await farmerEvent({ type: 'postback', postback: { data: `action=draft_confirm&id=${fd.id}&v=${fd.version}` } });
    const sale = await one<{ id: string; kind: string; status: string; total_qty_kg: string }>(
      'SELECT id, kind, status, total_qty_kg::text FROM material_listings WHERE org_id = $1', [ident.org_id]);
    expect(sale).toMatchObject({ kind: 'SALE', status: 'PUBLISHED', total_qty_kg: '5000.000' });

    // ---- route 2: the baler sees the farmer's listing (no farmer identity), offers 4000 kg; the farmer accepts in LINE ----
    const m2 = await call(baler, 'GET', '/matches?route=2');
    const match2 = m2.body.find((x: { counterparty: { entity_id: string } }) => x.counterparty.entity_id === sale.id);
    expect(match2).toMatchObject({ route: 2, counterparty: { entity_type: 'LISTING', display_name: null, org_kind: 'FARMER' } });
    const offer1 = await call(baler, 'POST', '/offers', { kind: 'PURCHASE', matchId: match2.id, qtyKg: '4000', unitPriceThb: '1.5', priceUnit: 'KG' });
    expect(offer1.status).toBe(201);
    await farmerEvent({ type: 'postback', postback: { data: `action=offer_accept&id=${offer1.body.offer.id}&v=${offer1.body.offer.version}` } });
    const src = (await call(baler, 'GET', '/agreements?kind=PURCHASE')).body;
    expect(src).toHaveLength(1);
    const source = src[0];
    expect(source).toMatchObject({ kind: 'PURCHASE', status: 'PURCHASE_CONFIRMED', qty_kg: '4000.000', buyer_org_id: baler.orgId, seller_org_id: ident.org_id });
    expect(await one('SELECT remaining_qty_kg::text AS r, committed_qty_kg::text AS c FROM material_listings WHERE id = $1', [sale.id])).toEqual({ r: '1000.000', c: '4000.000' });

    // ---- resale draft: draft only, quantity reserved, nothing published ----
    const rd = await call(baler, 'POST', `/agreements/${source.id}/resale-draft`, { qtyKg: '3000' });
    expect(rd.status).toBe(201);
    expect(rd.body.draft).toMatchObject({ kind: 'RESALE_LISTING', status: 'DRAFT', source_agreement_id: source.id, published_entity_id: null });
    expect(rd.body.draft.data).toEqual({ material_type: 'RICE_STRAW', qty_kg: '3000.000', pending_material: true });
    expect(rd.body.complete).toBe(false);
    expect(rd.body.missing_fields).toContain('expected_ready_at');
    expect(await reserved(source.id)).toBe('3000.000');
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM material_listings WHERE kind = 'RESALE'`)).n)).toBe(0);

    // allocation cap: only 1000 kg remain unreserved, so a second draft for 1500 kg is refused and changes nothing
    const over = await call(baler, 'POST', `/agreements/${source.id}/resale-draft`, { qtyKg: '1500' });
    expect(over.status).toBeGreaterThanOrEqual(400);
    expect(over.body.error.code).toBe('ALLOCATION_EXCEEDED');
    expect(await reserved(source.id)).toBe('3000.000');
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM drafts WHERE kind = 'RESALE_LISTING' AND source_agreement_id = $1`, [source.id])).n)).toBe(1);

    // ---- patch the resale fields (own location, pending material, expected_ready_at, price) and publish ----
    const patched = await call(baler, 'PATCH', `/drafts/${rd.body.draft.id}`, {
      expectedVersion: rd.body.draft.version,
      patch: {
        pending_material: true, expected_ready_at: '2030-01-01', price_mode: 'FIXED', price: { value: '1.8', unit: 'kg' },
        province: 'Uttaradit', lat: '17.700000', lng: '100.200000',
      },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.complete).toBe(true);
    expect(patched.body.draft.status).toBe('AWAITING_REVIEW');
    const pub = await call(baler, 'POST', `/drafts/${rd.body.draft.id}/publish`, { expectedVersion: patched.body.draft.version });
    expect(pub.status).toBe(200);
    expect(pub.body.entity_type).toBe('LISTING');
    const resaleId = pub.body.entity_id as string;
    await drain();
    expect(await one(
      `SELECT kind, status, pending_material, source_agreement_id, org_id, total_qty_kg::text AS qty, to_char(expected_ready_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS ready
         FROM material_listings WHERE id = $1`, [resaleId],
    )).toEqual({ kind: 'RESALE', status: 'PUBLISHED', pending_material: true, source_agreement_id: source.id, org_id: baler.orgId, qty: '3000.000', ready: '2030-01-01' });
    expect(await reserved(source.id)).toBe('3000.000');

    // ---- route 4: the factory sees the resale listing as pending material, without any farmer identity or source location ----
    const m4 = await call(factory, 'GET', '/matches?route=4');
    expect(m4.status).toBe(200);
    const match4 = m4.body.find((x: { counterparty: { entity_id: string } }) => x.counterparty.entity_id === resaleId);
    expect(match4).toMatchObject({
      route: 4, own_entity_id: factoryDemandId,
      counterparty: {
        entity_type: 'LISTING', org_kind: 'BALER', display_name: baler.name,
        published: { kind: 'RESALE', pending_material: true, expected_ready_at: '2030-01-01T00:00:00.000Z', remaining_qty_kg: '3000.000' },
      },
    });
    const hidden = [ident.org_id, ident.user_id, farmerOrgName, FARMER_LINE_ID, source.id, sale.id, '17.620000', '100.100000'];
    const seen = JSON.stringify(m4.body);
    for (const secret of hidden) expect(seen).not.toContain(secret);
    expect((await call(factory, 'GET', '/agreements')).body).toEqual([]);

    // ---- factory offer: refused without ackPendingMaterial, accepted into PENDING with it ----
    const terms = { kind: 'PURCHASE', matchId: match4.id, qtyKg: '1000', unitPriceThb: '1.8', priceUnit: 'KG' };
    const noAck = await call(factory, 'POST', '/offers', terms);
    expect(noAck.status).toBe(422);
    expect(noAck.body.error.fields[0].path).toBe('ackPendingMaterial');
    expect(Number((await one<{ n: string }>('SELECT count(*) AS n FROM offers WHERE listing_id = $1', [resaleId])).n)).toBe(0);
    const withAck = await call(factory, 'POST', '/offers', { ...terms, ackPendingMaterial: true });
    expect(withAck.status).toBe(201);
    expect(withAck.body.offer).toMatchObject({ status: 'PENDING', ack_pending_material: true, from_org_id: factory.orgId, to_org_id: baler.orgId });

    // ---- baler accepts: a new PURCHASE agreement linked to the source, and nothing says received/baled/paid ----
    const acc = await call(baler, 'POST', `/offers/${withAck.body.offer.id}/accept`, {});
    expect(acc.status).toBe(200);
    expect(acc.body.agreement).toMatchObject({
      kind: 'PURCHASE', status: 'PURCHASE_CONFIRMED', qty_kg: '1000.000', seller_org_id: baler.orgId, buyer_org_id: factory.orgId,
      listing_id: resaleId, source_agreement_id: source.id,
    });
    const newId = acc.body.agreement.id as string;
    expect(newId).not.toBe(source.id);
    expect((await one<{ source_agreement_id: string }>('SELECT source_agreement_id FROM agreements WHERE id = $1', [newId])).source_agreement_id).toBe(source.id);
    expect((await call(baler, 'GET', `/agreements/${newId}`)).body.source_agreement_id).toBe(source.id);

    // the factory's view hides the link and the farmer
    const fv = await call(factory, 'GET', `/agreements/${newId}`);
    expect(fv.status).toBe(200);
    expect(fv.body).toMatchObject({ id: newId, kind: 'PURCHASE', status: 'PURCHASE_CONFIRMED', source_agreement_id: null });
    const factoryText = JSON.stringify([fv.body, (await call(factory, 'GET', '/agreements')).body, acc.body.offer]);
    for (const secret of hidden) expect(factoryText).not.toContain(secret);
    // the farmer's agreement stays unchanged
    expect((await call(baler, 'GET', `/agreements/${source.id}`)).body).toMatchObject({ status: 'PURCHASE_CONFIRMED', qty_kg: '4000.000' });

    // quantities: the resale listing sold 1000 of 3000; the reservation stays at 3000 until the listing is closed
    expect(await one('SELECT total_qty_kg::text AS t, committed_qty_kg::text AS c, remaining_qty_kg::text AS r FROM material_listings WHERE id = $1', [resaleId]))
      .toEqual({ t: '3000.000', c: '1000.000', r: '2000.000' });
    expect(await reserved(source.id)).toBe('3000.000');

    // no agreement, in any view or row, claims receipt, baling or payment
    const statuses = (await db.pool.query<{ status: string }>('SELECT status FROM agreements')).rows.map((r) => r.status);
    expect(statuses.sort()).toEqual(['PURCHASE_CONFIRMED', 'PURCHASE_CONFIRMED']);
    const allText = JSON.stringify([acc.body, fv.body, source, (await db.pool.query('SELECT * FROM agreements')).rows]);
    expect(allText).not.toMatch(/RECEIVED|BALED|PAID|DELIVERED/); // status codes; the offer view's lowercase "direction":"received" is unrelated

    // ---- closing the resale listing releases the unsold reservation and keeps the 1000 kg sold ----
    const ver = (await one<{ version: number }>('SELECT version FROM material_listings WHERE id = $1', [resaleId])).version;
    const closed = await call(baler, 'POST', `/listings/${resaleId}/close`, { expectedVersion: ver });
    expect(closed.status).toBe(200);
    expect(await reserved(source.id)).toBe('1000.000');
    expect(await one('SELECT status, qty_kg::text AS q FROM resale_allocations WHERE listing_id = $1', [resaleId])).toEqual({ status: 'ACTIVE', q: '1000.000' });
    const again = await call(baler, 'POST', `/agreements/${source.id}/resale-draft`, { qtyKg: '3000' }); // freed quantity can be reserved again
    expect(again.status).toBe(201);
    expect(await reserved(source.id)).toBe('4000.000');

    // every queued job finished (closing the listing queued one more recompute); none is dead or waiting for a retry
    await drain();
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM jobs WHERE status <> 'DONE'`)).n)).toBe(0);
  });
});
