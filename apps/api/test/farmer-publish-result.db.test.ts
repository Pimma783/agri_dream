// Task 23.2: LINE result push to the farmer after publish, the keep/close postbacks, and one push per later new pair.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLineClient } from '../src/adapters/line/index.js';
import { composeAssistant } from '../src/assistant/index.js';
import { createFarmerHandler, createLineGateway } from '../src/channels/index.js';
import { decodePostback } from '../src/channels/line/codec.js';
import { webhookEvents, type Listing } from '../src/repos/index.js';
import {
  createConversationService, createDraftService, createLineEventStore, createListingService, createMatchingService,
  createMatchReadService, createOfferService, createWebhookService, type MatchingService,
} from '../src/services/index.js';
import { createLineIdentityService } from '../src/services/identity/index.js';
import { listingTips, NO_MATCH_HEAD } from '../src/services/matching/farmer-notify.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOrgWithUser } from './factories.js';

const NOW = new Date('2026-11-18T00:00:00Z');
const NEAR = { lat: '17.620000', lng: '100.100000' };
const FAR = { lat: '18.800000', lng: '98.900000' };
const LATER = { lat: '16.480000', lng: '99.520000' };

describe('listingTips', () => {
  const base = {
    price_mode: 'NEGOTIABLE', remaining_qty_kg: '10000.000', lat: '17.6', lng: '100.1', pending_material: false,
    expected_ready_at: null, transport_by: 'EITHER', available_from: new Date(), available_to: null,
  } as unknown as Listing;
  it('is deterministic, ordered, capped at 3 and uses only listing data', () => {
    const small = { ...base, price_mode: 'FIXED', remaining_qty_kg: '1000.000', lat: null, lng: null } as Listing;
    const a = listingTips(small);
    expect(a).toEqual(listingTips({ ...small }));
    expect(a).toHaveLength(3);
    expect(a[0]).toContain('ต่อรอง');
    expect(a[1]).toContain('ปริมาณน้อย');
    expect(a[2]).toContain('80 กม.');
  });
  it('always ends with the 80 km note when nothing else applies', () => {
    expect(listingTips(base)).toEqual(['ผู้รับซื้อต้องอยู่ในรัศมี 80 กม. จากที่ตั้งของคุณ']);
  });
});

describe.skipIf(!testDatabaseUrl)('farmer publish result (real Postgres, FakeLineClient)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let matching: MatchingService;
  let gateway: ReturnType<typeof createLineGateway>;
  const line = new FakeLineClient();
  let n = 0;
  let evt = 0;

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    matching = createMatchingService({ pool, now: () => NOW });
    const drafts = createDraftService({ pool });
    const conversations = createConversationService({ pool });
    const identity = createLineIdentityService({ pool, config: { linkCodeTtlMs: 600_000 } });
    gateway = createLineGateway({
      events: createLineEventStore({ pool }),
      line,
      handlers: {
        farmer: createFarmerHandler({
          identity, drafts, conversations, offers: createOfferService({ pool }), listings: createListingService({ pool }),
          assistant: composeAssistant({
            env: { ENABLE_REAL_BEDROCK: false, BEDROCK_MODEL_ID: 'anthropic.claude-sonnet-5', ASSISTANT_HISTORY_MESSAGES: 12, AI_MODE: 'disabled' },
            drafts, conversations, matches: createMatchReadService({ pool }),
          }),
        }),
        baler: async () => {},
        factory: async () => {},
      },
    });
  });
  afterAll(async () => { await db?.close(); });

  const recompute = async (entity_type: string, entity_id: string, version = 1) => {
    const r = await matching.recompute({ entity_type, entity_id, version });
    if (!r.ok) throw new Error(`recompute failed ${r.error.code}`);
  };

  /** A farmer who followed the OA (personal org + linked identity). */
  async function farmer() {
    const userId = `U-synthetic-pub-${++n}-${Date.now()}`;
    const webhooks = createWebhookService({ pool });
    const send = async (body: Record<string, unknown>) => {
      const eventId = `pub-${Date.now()}-${++evt}`;
      await webhooks.ingest('farmer', [{ webhookEventId: eventId, timestamp: Date.now(), source: { type: 'user', userId }, ...body }]);
      const row = (await webhookEvents.getByEvent(pool, 'farmer', eventId))!;
      await gateway.process(row.id);
      return row.id;
    };
    await send({ type: 'follow', replyToken: 'rt' });
    const ident = (await pool.query<{ id: string; org_id: string }>(`SELECT id, org_id FROM line_identities WHERE channel = 'farmer' AND line_user_id = $1`, [userId])).rows[0]!;
    return {
      orgId: ident.org_id, identityId: ident.id,
      postback: (data: string) => send({ type: 'postback', replyToken: 'rt', postback: { data } }),
      replyOf: async (eventRowId: string) =>
        (await pool.query<{ message: Array<{ text: string }> }>(`SELECT message FROM notification_outbox WHERE related_id = $1 ORDER BY created_at`, [eventRowId])).rows.flatMap((r) => r.message.map((m) => m.text)),
    };
  }
  const pushesTo = async (identityId: string) =>
    (await pool.query<{ dedupe_key: string; message: Array<{ text: string; quickReply?: { items: Array<{ action: { label: string; data: string } }> } }> }>(
      `SELECT dedupe_key, message FROM notification_outbox WHERE to_line_identity_id = $1 AND dedupe_key LIKE 'farmer-%' ORDER BY created_at, id`, [identityId],
    )).rows;

  it('queues one summary push when matches exist, labelled as an estimate, and dedupes repeat recomputes', async () => {
    const f = await farmer();
    const factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    await makeDemand(pool, factory.org.id, { ...NEAR });
    const listing = await makeListing(pool, f.orgId, { ...NEAR, province: 'นครสวรรค์' });
    await recompute('LISTING', listing.id);
    await recompute('LISTING', listing.id);
    const rows = await pushesTo(f.identityId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupe_key).toBe(`farmer-publish-result:${listing.id}:${f.identityId}`);
    const text = rows[0]!.message[0]!.text;
    expect(text).toContain('ผู้รับซื้อที่ตรงเงื่อนไข 1 ราย');
    expect(text).toContain('ประมาณการ');
    expect(rows[0]!.message[0]!.quickReply).toBeUndefined();
  });

  it('with no match queues the keep-open question, deterministic tips and two postback buttons', async () => {
    const f = await farmer();
    const listing = await makeListing(pool, f.orgId, { ...FAR, qty: '1000.000' });
    await recompute('LISTING', listing.id);
    const [row] = await pushesTo(f.identityId);
    const msg = row!.message[0]!;
    expect(msg.text.startsWith(NO_MATCH_HEAD)).toBe(true);
    expect(msg.text).toContain('ต่อรอง'); // factory listings are FIXED price
    expect(msg.text).toContain('ปริมาณน้อย');
    expect(msg.text.split('\n').filter((l) => /^\d\. /.test(l)).length).toBeLessThanOrEqual(3);
    const labels = msg.quickReply!.items.map((i) => i.action.label);
    expect(labels).toEqual(['เปิดประกาศไว้', 'ปิดประกาศ']);
    labels.forEach((l) => expect(l.split(/\s+/).length).toBeLessThanOrEqual(5));
    const decoded = msg.quickReply!.items.map((i) => decodePostback(i.action.data));
    expect(decoded.map((d) => d.ok && d.value.action)).toEqual(['listing_keep', 'listing_close']);
    expect(decoded.every((d) => d.ok && d.value.id === listing.id)).toBe(true);
  });

  it('skips silently for an organization without a linked LINE identity', async () => {
    const owner = await makeOrgWithUser(pool, 'FARMER');
    const listing = await makeListing(pool, owner.org.id, { ...FAR });
    await recompute('LISTING', listing.id);
    expect(Number((await pool.query(`SELECT count(*) FROM notification_outbox WHERE related_id = $1`, [listing.id])).rows[0].count)).toBe(0);
  });

  it('keep-open replies and changes nothing; close closes once and a second tap is graceful', async () => {
    const f = await farmer();
    const listing = await makeListing(pool, f.orgId, { ...FAR, qty: '1000.000' });
    await recompute('LISTING', listing.id);
    const buttons = (await pushesTo(f.identityId))[0]!.message[0]!.quickReply!.items.map((i) => i.action.data);

    const kept = await f.postback(buttons[0]!);
    expect((await f.replyOf(kept))[0]).toContain('ยังเปิดอยู่');
    expect((await pool.query(`SELECT status FROM material_listings WHERE id = $1`, [listing.id])).rows[0].status).toBe('PUBLISHED');

    const closed = await f.postback(buttons[1]!);
    expect((await f.replyOf(closed))[0]).toBe('ปิดประกาศแล้ว');
    expect((await pool.query(`SELECT status FROM material_listings WHERE id = $1`, [listing.id])).rows[0].status).toBe('CLOSED');
    const events = Number((await pool.query(`SELECT count(*) FROM audit_logs WHERE entity_id = $1 AND action = 'listing.closed'`, [listing.id])).rows[0].count);

    const again = await f.postback(buttons[1]!);
    expect((await f.replyOf(again))[0]).toBe('ประกาศนี้ปิดไปแล้ว');
    expect(Number((await pool.query(`SELECT count(*) FROM audit_logs WHERE entity_id = $1 AND action = 'listing.closed'`, [listing.id])).rows[0].count)).toBe(events);
  });

  it('rejects keep and close for a listing owned by someone else', async () => {
    const owner = await farmer();
    const intruder = await farmer();
    const listing = await makeListing(pool, owner.orgId, { ...FAR, qty: '1000.000' });
    await recompute('LISTING', listing.id);
    const buttons = (await pushesTo(owner.identityId))[0]!.message[0]!.quickReply!.items.map((i) => i.action.data);
    const ev = await intruder.postback(buttons[1]!);
    expect((await intruder.replyOf(ev))[0]).not.toBe('ปิดประกาศแล้ว');
    expect((await pool.query(`SELECT status FROM material_listings WHERE id = $1`, [listing.id])).rows[0].status).toBe('PUBLISHED');
    const ev2 = await intruder.postback(buttons[0]!);
    expect((await intruder.replyOf(ev2))[0]).not.toContain('ยังเปิดอยู่');
  });

  it('a buyer posting demand later sends one farmer push for the new pair, and never again', async () => {
    const f = await farmer();
    const listing = await makeListing(pool, f.orgId, { ...LATER, qty: '8000.000' });
    await recompute('LISTING', listing.id);
    expect(await pushesTo(f.identityId)).toHaveLength(1); // the no-match result
    const factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    const demand = await makeDemand(pool, factory.org.id, { ...LATER });
    await recompute('DEMAND', demand.id);
    await recompute('DEMAND', demand.id);
    await recompute('LISTING', listing.id);
    const rows = await pushesTo(f.identityId);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.dedupe_key).toBe(`farmer-new-match:${listing.id}:${demand.id}:${f.identityId}`);
    expect(rows[1]!.message[0]!.text).toContain('มีผู้รับซื้อใหม่');
    expect(rows[1]!.message[0]!.text).toContain('ประมาณการ');
  });
});
