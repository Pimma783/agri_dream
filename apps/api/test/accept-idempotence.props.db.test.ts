// Feature: agrimatch-mvp, Property 10: Accept is idempotent (real Postgres, task 8.4). Synthetic data only.
// **Validates: Requirements 12.8, 13.5**
//
// For a PENDING PURCHASE or BALING_SERVICE offer, accepting it k >= 1 times through the service, the HTTP route
// or a LINE postback (with or without the same Idempotency-Key, sequentially or concurrently) leaves exactly one
// agreement, one set of ledger rows, one notification per party and one audit pair, and every response carries the
// same agreement. The same key with a different request is IDEMPOTENCY_MISMATCH and writes nothing.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fc from 'fast-check';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLineClient } from '../src/adapters/line/index.js';
import { MockBedrock } from '../src/adapters/bedrock/test-support.js';
import { composeAssistant } from '../src/assistant/index.js';
import { createBalerHandler, createFactoryHandler, createFarmerHandler, createLineGateway } from '../src/channels/index.js';
import { EnvSchema } from '../src/config/env.js';
import type { Actor } from '../src/domain/permissions.js';
import { createApp } from '../src/http/app.js';
import { mountOfferRoutes } from '../src/http/offer-routes.js';
import { createLogger } from '../src/logger.js';
import { balingRequests, balingServices, lineIdentities, offers, webhookEvents } from '../src/repos/index.js';
import {
  createConversationService, createDraftService, createLineEventStore, createMatchReadService, createOfferService,
  createWebhookService, type OfferService, type Result,
} from '../src/services/index.js';
import { createAuthService, createDemoOrgUser, LoginRateLimiter } from '../src/services/auth/index.js';
import { createLineIdentityService } from '../src/services/identity/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOrgWithUser } from './factories.js';

const ORIGIN = 'http://localhost:3000';
const PW = 'synthetic-Passw0rd-for-tests';

type Kind = 'PURCHASE' | 'BALING_SERVICE';
type Path = 'service' | 'http' | 'line';
interface Out { ok: boolean; code?: string; agreementId?: string; replayed?: boolean; norm?: string }
interface Session { cookie: string; csrf: string }

const arb = fc.record({
  kind: fc.constantFrom<Kind>('PURCHASE', 'BALING_SERVICE'),
  path: fc.constantFrom<Path>('service', 'http', 'line'),
  k: fc.integer({ min: 1, max: 5 }),
  keyed: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
  concurrent: fc.boolean(),
  qtyThousands: fc.integer({ min: 1, max: 10 }),
  retap: fc.boolean(),
});

describe.skipIf(!testDatabaseUrl)('Property 10: accept is idempotent (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let svc: OfferService;
  let server: Server;
  let base: string;
  let gateway: ReturnType<typeof createLineGateway>;
  let seq = 0;
  const webhooks = () => createWebhookService({ pool });

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    svc = createOfferService({ pool });
    const auth = createAuthService({
      pool, config: { idleMs: 3_600_000, absoluteMs: 18_000_000 }, limiter: new LoginRateLimiter({ maxAttempts: 1000, windowMs: 60_000 }),
    });
    const env = EnvSchema.parse({ NODE_ENV: 'test', WEB_ORIGIN: ORIGIN });
    const app = createApp({ env, logger: createLogger('silent'), auth, mountRoutes: (a) => mountOfferRoutes(a, { pool }) });
    server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const drafts = createDraftService({ pool });
    const conversations = createConversationService({ pool });
    const identity = createLineIdentityService({ pool, config: { linkCodeTtlMs: 600_000 } });
    gateway = createLineGateway({
      events: createLineEventStore({ pool }),
      line: new FakeLineClient(),
      handlers: {
        farmer: createFarmerHandler({
          identity, drafts, conversations, offers: svc,
          assistant: composeAssistant({
            env: { ENABLE_REAL_BEDROCK: true, BEDROCK_MODEL_ID: 'anthropic.claude-sonnet-5', ASSISTANT_HISTORY_MESSAGES: 12, AI_MODE: 'enabled' },
            drafts, conversations, matches: createMatchReadService({ pool }), bedrock: new MockBedrock([]),
          }),
        }),
        baler: createBalerHandler({ identity, offers: createOfferService({ pool }), matches: createMatchReadService({ pool }), webOrigin: 'http://localhost:3000' }),
        factory: createFactoryHandler({ identity, offers: createOfferService({ pool }), matches: createMatchReadService({ pool }), webOrigin: 'http://localhost:3000' }),
      },
    });
  }, 60_000);
  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    await db?.close();
  });

  type Party = Awaited<ReturnType<typeof makeOrgWithUser>>;
  const actorOf = (p: Party, role: Actor['role']): Actor => ({ userId: p.user.id, orgId: p.org.id, role, channel: 'web' });
  const rows = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query<T>(sql, params)).rows;

  async function link(orgId: string, userId: string, channel: 'farmer' | 'baler' | 'factory') {
    const id = await lineIdentities.ensure(pool, channel, `U-synthetic-${orgId}`);
    await lineIdentities.link(pool, id.id, userId, orgId);
  }

  // ---- LINE helpers -------------------------------------------------------------------------------------------
  let evt = 0;
  async function store(userId: string, body: Record<string, unknown>) {
    const eventId = `evt-p10-${Date.now()}-${++evt}`;
    await webhooks().ingest('farmer', [{ webhookEventId: eventId, timestamp: Date.now(), source: { type: 'user', userId }, ...body }]);
    return (await webhookEvents.getByEvent(pool, 'farmer', eventId))!.id;
  }
  const pushes = async (eventRowId: string) =>
    (await pool.query<{ message: unknown }>(`SELECT message FROM notification_outbox WHERE related_id = $1 ORDER BY created_at`, [eventRowId])).rows.map((r) => r.message);

  // ---- scenario -----------------------------------------------------------------------------------------------
  interface Farmer { orgId: string; userId: string; session?: Session; lineUserId?: string }

  async function makeFarmer(path: Path): Promise<Farmer> {
    if (path === 'line') {
      const lineUserId = `U-synthetic-p10-${Date.now()}-${++seq}`;
      const f = await store(lineUserId, { type: 'follow', replyToken: 'rt' });
      expect(await gateway.process(f)).toBe('handled');
      const idn = (await rows<{ org_id: string; user_id: string }>(`SELECT org_id, user_id FROM line_identities WHERE channel = 'farmer' AND line_user_id = $1`, [lineUserId]))[0]!;
      return { orgId: idn.org_id, userId: idn.user_id, lineUserId };
    }
    if (path === 'http') {
      const email = `p10-${Date.now()}-${++seq}@example.invalid`;
      const { org, user } = await createDemoOrgUser(pool, { kind: 'FARMER', orgName: `synthetic-p10-${seq}`, email, password: PW });
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password: PW }),
      });
      expect(res.status).toBe(204);
      const cookie = `agrimatch_sid=${/agrimatch_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`;
      const me = (await (await fetch(`${base}/me`, { headers: { cookie } })).json()) as { csrf_secret: string };
      await link(org.id, user.id, 'farmer');
      return { orgId: org.id, userId: user.id, session: { cookie, csrf: me.csrf_secret } };
    }
    const p = await makeOrgWithUser(pool, 'FARMER');
    await link(p.org.id, p.user.id, 'farmer');
    return { orgId: p.org.id, userId: p.user.id };
  }

  async function makeScenario(kind: Kind, path: Path, qtyKg: string) {
    const farmer = await makeFarmer(path);
    const sender = await makeOrgWithUser(pool, kind === 'PURCHASE' ? 'BUYER_FACTORY' : 'BALER');
    const senderChannel = kind === 'PURCHASE' ? 'factory' : 'baler';
    await link(sender.org.id, sender.user.id, senderChannel);
    const senderActor = actorOf(sender, kind === 'PURCHASE' ? 'BUYER_FACTORY' : 'BALER');
    let offerId: string;
    let listingId: string | null = null;
    let demandId: string | null = null;
    let requestId: string | null = null;
    let serviceId: string | null = null;
    if (kind === 'PURCHASE') {
      const listing = await makeListing(pool, farmer.orgId);
      const demand = await makeDemand(pool, sender.org.id);
      listingId = listing.id; demandId = demand.id;
      const r = await svc.create(senderActor, { kind: 'PURCHASE', listingId, demandId, qtyKg, unitPriceThb: '1.5', priceUnit: 'KG' });
      if (!r.ok) throw new Error(`offer create failed: ${r.error.code}`);
      offerId = r.value.offer.id;
    } else {
      const service = await balingServices.insert(pool, {
        org_id: sender.org.id, material_types: ['RICE_STRAW'], service_mode: 'BOTH', price_mode: 'FIXED', status: 'PUBLISHED',
        unit_price_thb: '0.5000', price_unit: 'KG', min_qty_kg: '100', is_demo: false,
      });
      const request = await balingRequests.insert(pool, {
        org_id: farmer.orgId, material_type: 'RICE_STRAW', qty_kg: '50000.000', requested_mode: 'ON_SITE', status: 'PUBLISHED', is_demo: false,
      });
      serviceId = service.id; requestId = request.id;
      const r = await svc.create(senderActor, { kind: 'BALING_SERVICE', balingServiceId: serviceId, balingRequestId: requestId, qtyKg, unitPriceThb: '0.5', priceUnit: 'KG' });
      if (!r.ok) throw new Error(`offer create failed: ${r.error.code}`);
      offerId = r.value.offer.id;
    }
    return { farmer, sender, senderChannel, offerId, listingId, demandId, requestId, serviceId };
  }
  type Scenario = Awaited<ReturnType<typeof makeScenario>>;

  // ---- one accept call per path -------------------------------------------------------------------------------
  const fromResult = (r: Result<unknown>): Out => {
    if (!r.ok) return { ok: false, code: r.error.code };
    const v = r.value as { agreement: { id: string }; offer: unknown; replayed: boolean };
    return { ok: true, agreementId: v.agreement.id, replayed: v.replayed, norm: JSON.stringify({ agreement: v.agreement, offer: v.offer }) };
  };
  async function acceptService(s: Scenario, key?: string, ack?: boolean): Promise<Out> {
    const actor: Actor = { userId: s.farmer.userId, orgId: s.farmer.orgId, role: 'FARMER', channel: 'web' };
    return fromResult(await svc.accept(actor, { offerId: s.offerId, ...(key ? { idempotencyKey: key } : {}), ...(ack !== undefined ? { ackPendingMaterial: ack } : {}) }));
  }
  async function acceptHttp(s: Scenario, key?: string, ack?: boolean): Promise<Out> {
    const sess = s.farmer.session!;
    const res = await fetch(`${base}/offers/${s.offerId}/accept`, {
      method: 'POST',
      headers: {
        cookie: sess.cookie, origin: ORIGIN, 'x-csrf-token': sess.csrf, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}),
      },
      body: JSON.stringify(ack !== undefined ? { ackPendingMaterial: ack } : {}),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (res.status !== 200) return { ok: false, code: `${res.status}:${body?.error?.code}` };
    return { ok: true, agreementId: body.agreement.id, replayed: body.replayed, norm: JSON.stringify({ agreement: body.agreement, offer: body.offer }) };
  }

  /** Everything the accept may write, scoped to this offer so other files and agents do not interfere. */
  async function effects(s: Scenario) {
    const ag = await rows<{ id: string; status: string; qty_kg: string }>(`SELECT id, status, qty_kg FROM agreements WHERE offer_id = $1`, [s.offerId]);
    const ids = [s.offerId, ...ag.map((a) => a.id)];
    return {
      agreements: ag,
      offer: (await rows(`SELECT status, version FROM offers WHERE id = $1`, [s.offerId]))[0],
      ledger: await rows(`SELECT subject_type, entry_kind, qty_kg FROM quantity_ledger WHERE agreement_id = ANY($1::uuid[]) ORDER BY subject_type`, [ag.map((a) => a.id)]),
      outbox: await rows(`SELECT channel, dedupe_key FROM notification_outbox WHERE related_id = $1 AND dedupe_key LIKE '%:accepted:%' ORDER BY channel`, [s.offerId]),
      audit: await rows(`SELECT action, count(*)::int AS n FROM audit_logs WHERE entity_id::text = ANY($1::text[]) AND action IN ('offer.accepted','agreement.created') GROUP BY action ORDER BY action`, [ids]),
      idem: await rows(`SELECT count(*)::int AS n FROM idempotency_keys WHERE scope = $1`, [`offer.accept:${s.offerId}`]),
      listing: s.listingId ? (await rows(`SELECT committed_qty_kg, remaining_qty_kg, status, version FROM material_listings WHERE id = $1`, [s.listingId]))[0] : null,
      demand: s.demandId ? (await rows(`SELECT committed_qty_kg, remaining_qty_kg, status, version FROM purchase_demands WHERE id = $1`, [s.demandId]))[0] : null,
      request: s.requestId ? (await rows(`SELECT qty_kg, status, version FROM baling_requests WHERE id = $1`, [s.requestId]))[0] : null,
      service: s.serviceId ? (await rows(`SELECT status, version FROM baling_services WHERE id = $1`, [s.serviceId]))[0] : null,
    };
  }

  function expectSingleAcceptEffects(s: Scenario, kind: Kind, qtyKg: string, e: Awaited<ReturnType<typeof effects>>) {
    expect(e.agreements).toHaveLength(1);
    expect(e.agreements[0]).toMatchObject({ status: kind === 'PURCHASE' ? 'PURCHASE_CONFIRMED' : 'SERVICE_CONFIRMED', qty_kg: `${qtyKg}.000` });
    expect(e.offer).toMatchObject({ status: 'ACCEPTED' });
    expect(e.audit).toEqual([{ action: 'agreement.created', n: 1 }, { action: 'offer.accepted', n: 1 }]);
    // one notification per party: the sender's channel and the farmer channel
    expect(e.outbox.map((o) => o.channel)).toEqual([s.senderChannel, 'farmer'].sort());
    expect(new Set(e.outbox.map((o) => o.dedupe_key)).size).toBe(2);
    if (kind === 'PURCHASE') {
      expect(e.ledger).toEqual([
        { subject_type: 'DEMAND', entry_kind: 'COMMIT', qty_kg: `${qtyKg}.000` },
        { subject_type: 'LISTING', entry_kind: 'COMMIT', qty_kg: `${qtyKg}.000` },
      ]);
      const left = 10000 - Number(qtyKg);
      expect(e.listing).toMatchObject({ committed_qty_kg: `${qtyKg}.000`, remaining_qty_kg: `${left}.000`, status: left === 0 ? 'CLOSED' : 'PUBLISHED', version: 2 });
      expect(e.demand).toMatchObject({ committed_qty_kg: `${qtyKg}.000`, remaining_qty_kg: `${50000 - Number(qtyKg)}.000`, version: 2 });
    } else {
      expect(e.ledger).toEqual([]);
      expect(e.request).toMatchObject({ qty_kg: '50000.000', status: 'PUBLISHED', version: 1 });
      expect(e.service).toMatchObject({ status: 'PUBLISHED', version: 1 });
    }
  }

  it('k accepts via service, HTTP or LINE, with or without a key, leave one agreement, one ledger set and one notification per party', async () => {
    await fc.assert(
      fc.asyncProperty(arb, async ({ kind, path, k, keyed, concurrent, qtyThousands, retap }) => {
        const qtyKg = String(qtyThousands * 1000);
        const s = await makeScenario(kind, path, qtyKg);

        if (path === 'line') {
          const version = (await offers.get(pool, s.offerId))!.version;
          const eventRow = await store(s.farmer.lineUserId!, { type: 'postback', replyToken: 'rt', postback: { data: `action=offer_accept&id=${s.offerId}&v=${version}` } });
          for (let i = 0; i < k; i += 1) await gateway.process(eventRow); // the same webhook event replayed k times
          const reply = await pushes(eventRow);
          expect(reply).toHaveLength(1);
          expect(JSON.stringify(reply[0])).toContain('ยืนยันข้อตกลงแล้ว');
          const after = await effects(s);
          expectSingleAcceptEffects(s, kind, qtyKg, after);
          await gateway.process(eventRow);
          expect(await pushes(eventRow)).toEqual(reply); // identical response, no second message
          if (retap) {
            // The user taps the same button again: a new webhook event with the old button data. No new effect.
            const again = await store(s.farmer.lineUserId!, { type: 'postback', replyToken: 'rt', postback: { data: `action=offer_accept&id=${s.offerId}&v=${version}` } });
            await gateway.process(again);
            expect(await effects(s)).toEqual(after);
          }
          return;
        }

        const call = path === 'http' ? acceptHttp : acceptService;
        const key = `acc-${s.offerId}`;
        const keys = Array.from({ length: k }, (_, i) => (keyed[i] ? key : undefined));
        let outs: Out[];
        if (concurrent) outs = await Promise.all(keys.map((x) => call(s, x)));
        else {
          outs = [];
          for (const x of keys) outs.push(await call(s, x));
        }

        expect(outs.every((o) => o.ok)).toBe(true);
        expect(new Set(outs.map((o) => o.agreementId)).size).toBe(1);
        expect(new Set(outs.map((o) => o.norm)).size).toBe(1); // identical responses apart from the replayed flag
        expect(outs.filter((o) => o.replayed === false)).toHaveLength(1);
        if (!concurrent) expect(outs[0]!.replayed).toBe(false);
        const after = await effects(s);
        expectSingleAcceptEffects(s, kind, qtyKg, after);
        expect(after.agreements[0]!.id).toBe(outs[0]!.agreementId);
        expect(after.idem).toEqual([{ n: keys.some(Boolean) ? 1 : 0 }]);

        if (keys.some(Boolean)) {
          // Same key, different request: nothing is written.
          const mismatch = await call(s, key, true);
          expect(mismatch.ok).toBe(false);
          expect(mismatch.code).toMatch(path === 'http' ? /^422:IDEMPOTENCY_MISMATCH$/ : /^IDEMPOTENCY_MISMATCH$/);
          expect(await effects(s)).toEqual(after);
        }
      }),
    );
  });

  // Observation for the report: a second tap on the same LINE button arrives as a new webhook event. The button
  // carries the old offer version, and accept bumps the version, so the handler answers "needVersion" instead of
  // the confirmation. No data changes (asserted in the property above), only the response differs.
  // The handler now returns the same confirmation for an offer this receiver already accepted.
  it('a second tap (new LINE event) returns the same confirmation as the first', async () => {
    const s = await makeScenario('PURCHASE', 'line', '1000');
    const version = (await offers.get(pool, s.offerId))!.version;
    const data = `action=offer_accept&id=${s.offerId}&v=${version}`;
    const first = await store(s.farmer.lineUserId!, { type: 'postback', replyToken: 'rt', postback: { data } });
    await gateway.process(first);
    const second = await store(s.farmer.lineUserId!, { type: 'postback', replyToken: 'rt', postback: { data } });
    await gateway.process(second);
    expect(await pushes(second)).toEqual(await pushes(first));
  });
});
