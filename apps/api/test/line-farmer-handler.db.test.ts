// Task 9.8: farmer channel handler through the gateway, real Postgres services, FakeLineClient and MockBedrock only.
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLineClient } from '../src/adapters/line/index.js';
import { MockBedrock, type MockStep } from '../src/adapters/bedrock/test-support.js';
import { composeAssistant } from '../src/assistant/index.js';
import {
  createBalerHandler, createFactoryHandler, createFarmerHandler, createLineGateway,
} from '../src/channels/index.js';
import { HandlerRegistry, JobRunner, registerLineEvent } from '../src/jobs/index.js';
import { webhookEvents } from '../src/repos/index.js';
import {
  createConversationService, createDraftService, createJobQueue, createLineEventStore, createMatchReadService,
  createOfferService, createWebhookService,
} from '../src/services/index.js';
import { createLineIdentityService } from '../src/services/identity/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOffer, makeOrgWithUser } from './factories.js';

const turn = (over: Record<string, unknown>): MockStep => ({ type: 'json', value: { intent: 'SELL_MATERIAL', reply_text: 'รับทราบ', ...over } });

describe.skipIf(!testDatabaseUrl)('farmer LINE handler (real services, fakes for LINE and Bedrock)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  const line = new FakeLineClient();
  let bedrock: MockBedrock;
  let gateway: ReturnType<typeof createLineGateway>;
  const webhooks = () => createWebhookService({ pool });
  let n = 0;
  const uid = () => `U-synthetic-farmer-${++n}-${Date.now()}`;

  const build = (script: MockStep[] = []) => {
    bedrock = new MockBedrock(script);
    const drafts = createDraftService({ pool });
    const conversations = createConversationService({ pool });
    const identity = createLineIdentityService({ pool, config: { linkCodeTtlMs: 600_000 } });
    gateway = createLineGateway({
      events: createLineEventStore({ pool }),
      line,
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
  };

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    build();
  });
  afterAll(async () => { await db?.close(); });

  let evt = 0;
  /** Stores one webhook event (as the webhook route does) and returns its row id. */
  async function store(channel: 'farmer' | 'baler' | 'factory', userId: string, body: Record<string, unknown>) {
    const eventId = `evt-${Date.now()}-${++evt}`;
    await webhooks().ingest(channel, [{ webhookEventId: eventId, timestamp: Date.now(), source: { type: 'user', userId }, ...body }]);
    const row = await webhookEvents.getByEvent(pool, channel, eventId);
    return row!.id;
  }
  const textEvt = (text: string) => ({ type: 'message', replyToken: 'rt', message: { type: 'text', text } });
  const postbackEvt = (data: string) => ({ type: 'postback', replyToken: 'rt', postback: { data } });
  const followEvt = { type: 'follow', replyToken: 'rt' };

  const pushes = async (eventRowId: string) =>
    (await pool.query<{ message: Array<{ text: string; quickReply: { items: Array<{ action: { label: string } }> } }> }>(`SELECT message FROM notification_outbox WHERE related_id = $1 ORDER BY created_at`, [eventRowId])).rows
      .flatMap((r) => r.message);
  const count = async (sql: string, params: unknown[]) => Number((await pool.query(sql, params)).rows[0].count);
  const orgOf = async (userId: string) =>
    (await pool.query<{ org_id: string; user_id: string }>(`SELECT org_id, user_id FROM line_identities WHERE channel = 'farmer' AND line_user_id = $1`, [userId])).rows[0]!;

  async function follow(userId = uid()) {
    const id = await store('farmer', userId, followEvt);
    expect(await gateway.process(id)).toBe('handled');
    return { userId, eventRow: id, ...(await orgOf(userId)) };
  }

  it('follow creates one personal FARMER org and greets with the five menu shortcuts (AI on: free-text invitation)', async () => {
    const { userId, eventRow, org_id } = await follow();
    const again = await store('farmer', userId, followEvt);
    await gateway.process(again);
    expect(await count(`SELECT count(*) FROM memberships WHERE org_id = $1`, [org_id])).toBe(1);
    expect(await count(`SELECT count(*) FROM organizations o JOIN line_identities l ON l.org_id = o.id WHERE l.line_user_id = $1`, [userId])).toBe(1);
    expect((await pool.query(`SELECT kind FROM organizations WHERE id = $1`, [org_id])).rows[0].kind).toBe('FARMER');
    const msg = (await pushes(eventRow))[0]!;
    expect(msg.quickReply.items.map((i) => i.action.label)).toEqual(['ลงขายวัสดุ', 'หาผู้รับอัด', 'รายการของฉัน', 'ข้อเสนอ', 'ช่วยเหลือ']);
  });

  it('a text turn creates and patches a draft, replays without a second effect, and sends only to the farmer channel', async () => {
    build([turn({ draft_patch: { kind: 'SALE_LISTING', fields: { material_type: 'RICE_STRAW', quantity: { value: '5', unit: 'ton' } } } })]);
    const { userId, org_id } = await follow();
    const id = await store('farmer', userId, textEvt('ขายฟางข้าว 5 ตัน'));
    await gateway.process(id);
    expect(await count(`SELECT count(*) FROM drafts WHERE org_id = $1`, [org_id])).toBe(1);
    const d = (await pool.query(`SELECT data FROM drafts WHERE org_id = $1`, [org_id])).rows[0];
    expect(d.data).toMatchObject({ material_type: 'RICE_STRAW', qty_kg: '5000.000' });
    expect((await pushes(id)).length).toBe(1);
    // Replay of the same job: no second model call, no second draft, no second message.
    await gateway.process(id);
    expect(bedrock.calls.length).toBe(1);
    expect(await count(`SELECT count(*) FROM drafts WHERE org_id = $1`, [org_id])).toBe(1);
    expect((await pushes(id)).length).toBe(1);
    expect(await count(`SELECT count(*) FROM notification_outbox WHERE related_id = $1 AND channel <> 'farmer'`, [id])).toBe(0);
  });

  it('a location message is stored on the active draft as the user\'s coordinates', async () => {
    build([turn({ draft_patch: { kind: 'SALE_LISTING', fields: { material_type: 'RICE_STRAW' } } })]);
    const { userId, org_id } = await follow();
    await gateway.process(await store('farmer', userId, textEvt('ขายฟาง')));
    await gateway.process(await store('farmer', userId, { type: 'message', message: { type: 'location', latitude: 17.62, longitude: 100.1 } }));
    const d = (await pool.query(`SELECT data FROM drafts WHERE org_id = $1`, [org_id])).rows[0];
    expect(d.data).toMatchObject({ lat: '17.620000', lng: '100.100000' });
  });

  it('a location without an active draft changes nothing and asks to start one', async () => {
    const { userId, org_id, eventRow } = await follow();
    const id = await store('farmer', userId, { type: 'message', message: { type: 'location', latitude: 17.6, longitude: 100.1 } });
    await gateway.process(id);
    expect(await count(`SELECT count(*) FROM drafts WHERE org_id = $1`, [org_id])).toBe(0);
    expect((await pushes(id)).length).toBe(1);
    expect(eventRow).toBeTruthy();
  });

  async function completeDraft(userId: string, orgId: string, user: string) {
    const drafts = createDraftService({ pool });
    const actor = { userId: user, orgId, role: 'FARMER' as const, channel: 'line:farmer' as const };
    const r = await drafts.create(actor, {
      kind: 'SALE_LISTING',
      patch: { material_type: 'RICE_STRAW', quantity: { value: '5', unit: 'ton' }, price_mode: 'NEGOTIABLE', province: 'Uttaradit' },
    });
    if (!r.ok) throw new Error(r.error.code);
    expect(userId).toBeTruthy();
    return r.value.draft;
  }

  it('a confirm postback publishes once, a replay does not duplicate, and a stale version is rejected', async () => {
    const { userId, org_id, user_id } = await follow();
    const draft = await completeDraft(userId, org_id, user_id);
    const stale = await store('farmer', userId, postbackEvt(`action=draft_confirm&id=${draft.id}&v=${draft.version + 5}`));
    await gateway.process(stale);
    expect(await count(`SELECT count(*) FROM material_listings WHERE org_id = $1`, [org_id])).toBe(0);
    expect((await pushes(stale))[0]!.text).toContain('เปลี่ยนแปลง');
    const ok = await store('farmer', userId, postbackEvt(`action=draft_confirm&id=${draft.id}&v=${draft.version}`));
    await gateway.process(ok);
    await gateway.process(ok);
    expect(await count(`SELECT count(*) FROM material_listings WHERE org_id = $1`, [org_id])).toBe(1);
    expect((await pushes(ok))[0]!.text).toContain('เผยแพร่เรียบร้อย');
  });

  it('keep and edit postbacks leave the draft unpublished; edit makes it the active draft', async () => {
    const { userId, org_id, user_id } = await follow();
    const draft = await completeDraft(userId, org_id, user_id);
    await gateway.process(await store('farmer', userId, postbackEvt(`action=draft_keep&id=${draft.id}&v=${draft.version}`)));
    await gateway.process(await store('farmer', userId, postbackEvt(`action=draft_edit&id=${draft.id}&v=${draft.version}`)));
    expect(await count(`SELECT count(*) FROM material_listings WHERE org_id = $1`, [org_id])).toBe(0);
    expect((await pool.query(`SELECT active_draft_id FROM conversations WHERE org_id = $1`, [org_id])).rows[0].active_draft_id).toBe(draft.id);
  });

  it("a postback cannot touch another organization's draft", async () => {
    const mine = await follow();
    const other = await follow();
    const draft = await completeDraft(other.userId, other.org_id, other.user_id);
    const id = await store('farmer', mine.userId, postbackEvt(`action=draft_confirm&id=${draft.id}&v=${draft.version}`));
    await gateway.process(id);
    expect(await count(`SELECT count(*) FROM material_listings WHERE org_id = $1`, [other.org_id])).toBe(0);
    expect((await pushes(id))[0]!.text).toContain('ไม่พบข้อมูล');
  });

  it('an accept postback creates one agreement; a replay and a stale version create no second one', async () => {
    const { userId, org_id } = await follow();
    const factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    const listing = await makeListing(pool, org_id);
    const demand = await makeDemand(pool, factory.org.id);
    const offer = await makeOffer(pool, { listing, demand });
    const stale = await store('farmer', userId, postbackEvt(`action=offer_accept&id=${offer.id}&v=${offer.version + 3}`));
    await gateway.process(stale);
    expect(await count(`SELECT count(*) FROM agreements WHERE offer_id = $1`, [offer.id])).toBe(0);
    const id = await store('farmer', userId, postbackEvt(`action=offer_accept&id=${offer.id}&v=${offer.version}`));
    await gateway.process(id);
    await gateway.process(id);
    expect(await count(`SELECT count(*) FROM agreements WHERE offer_id = $1`, [offer.id])).toBe(1);
    expect((await pushes(id))[0]!.text).toContain('ไม่ใช่หลักฐานการชำระเงิน');
  });

  it('a reject postback rejects the offer', async () => {
    const { userId, org_id } = await follow();
    const factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    const offer = await makeOffer(pool, { listing: await makeListing(pool, org_id), demand: await makeDemand(pool, factory.org.id) });
    await gateway.process(await store('farmer', userId, postbackEvt(`action=offer_reject&id=${offer.id}&v=${offer.version}`)));
    expect((await pool.query(`SELECT status FROM offers WHERE id = $1`, [offer.id])).rows[0].status).toBe('REJECTED');
  });

  it('a malformed postback and an unlinked farmer get a safe reply and no effect', async () => {
    build();
    const { userId } = await follow();
    const bad = await store('farmer', userId, postbackEvt('action=nope&id=x'));
    await gateway.process(bad);
    expect((await pushes(bad)).length).toBe(1);
    // No follow was ever received for this LINE user, so no identity row exists: nothing can be queued for them.
    const stranger = await store('farmer', uid(), textEvt('สวัสดี'));
    expect(await gateway.process(stranger)).toBe('handled');
    expect(bedrock.calls.length).toBe(0);
  });

  it('image and unknown events are handled safely', async () => {
    const { userId } = await follow();
    const img = await store('farmer', userId, { type: 'message', message: { type: 'image', id: '1' } });
    await gateway.process(img);
    expect((await pushes(img)).length).toBe(1);
    const other = await store('farmer', userId, { type: 'unfollow' });
    expect(await gateway.process(other)).toBe('ignored');
  });

  it('an unlinked baler gets the link prompt and no organization', async () => {
    const userId = `U-synthetic-baler-${Date.now()}`;
    const fol = await store('baler', userId, followEvt);
    await gateway.process(fol);
    const txt = await store('baler', userId, textEvt('สวัสดี'));
    await gateway.process(txt);
    expect((await pushes(txt))[0]!.text).toContain('รหัสผูกบัญชี');
    const row = (await pool.query(`SELECT status, org_id FROM line_identities WHERE channel = 'baler' AND line_user_id = $1`, [userId])).rows[0];
    expect(row).toMatchObject({ status: 'UNLINKED', org_id: null });
  });

  it('a linked baler or factory text gets the Dashboard pointer on its own channel', async () => {
    const identity = createLineIdentityService({ pool, config: { linkCodeTtlMs: 600_000 } });
    for (const [channel, kind] of [['factory', 'BUYER_FACTORY'], ['baler', 'BALER']] as const) {
      const p = await makeOrgWithUser(pool, kind);
      const issued = await identity.issueLinkCode({ userId: p.user.id, orgId: p.org.id, role: kind, channel: 'web' });
      if (!issued.ok) throw new Error('issue');
      const userId = `U-synthetic-${channel}-${Date.now()}`;
      const fol = await store(channel, userId, followEvt);
      await gateway.process(fol);
      const redeemed = await identity.redeemLinkCode({ channel, lineUserId: userId, code: issued.value.code });
      expect(redeemed.ok).toBe(true);
      const txt = await store(channel, userId, textEvt('เมนู'));
      await gateway.process(txt);
      const rows = await pool.query(`SELECT channel, message FROM notification_outbox WHERE related_id = $1`, [txt]);
      expect(rows.rows[0].channel).toBe(channel);
      expect(rows.rows[0].message[0].text).toContain('Dashboard');
    }
  });

  it('the line_event job runs through the registry and ends DONE, never NO_HANDLER', async () => {
    const { userId } = await follow();
    const id = await store('farmer', userId, textEvt('ทดสอบ'));
    const jobRow = (await pool.query(`SELECT id FROM jobs WHERE kind = 'line_event' AND payload->>'webhook_event_id' = $1`, [id])).rows[0];
    build([{ type: 'json', value: { intent: 'GENERAL', reply_text: 'สวัสดีครับ' } }]);
    const handlers = new HandlerRegistry();
    registerLineEvent(handlers, { gateway });
    await new JobRunner({ queue: createJobQueue(pool), handlers, batchSize: 200 }).tick();
    const status = (await pool.query(`SELECT status, last_error_code FROM jobs WHERE id = $1`, [jobRow.id])).rows[0];
    expect(status.last_error_code).not.toBe('NO_HANDLER');
    expect(status.status).toBe('DONE');
  });

  it('the worker registers line_event in its single registration block', () => {
    const src = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
    expect(src).toContain('registerLineEvent(handlers');
  });
});
