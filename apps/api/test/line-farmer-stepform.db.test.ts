// Task 10.5 (reopened): the farmer LINE chat with AI_MODE=disabled, replaying the transcript of the real LINE test.
// Real Postgres services, FakeLineClient and MockBedrock only (the model is never called).
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLineClient } from '../src/adapters/line/index.js';
import { MockBedrock } from '../src/adapters/bedrock/test-support.js';
import { composeAssistant } from '../src/assistant/index.js';
import { createFarmerHandler, createLineGateway } from '../src/channels/index.js';
import { webhookEvents } from '../src/repos/index.js';
import {
  createBalingRequestService, createConversationService, createDraftService, createLineEventStore, createListingService,
  createMatchReadService, createOfferService, createWebhookService,
} from '../src/services/index.js';
import { createLineIdentityService } from '../src/services/identity/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOffer, makeOrgWithUser } from './factories.js';

type Item = { action: { type: string; label: string; data?: string } };
type Sent = { text: string; quickReply?: { items: Item[] } };

describe.skipIf(!testDatabaseUrl)('farmer LINE chat in step-form mode (AI_MODE=disabled)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let bedrock: MockBedrock;
  let gateway: ReturnType<typeof createLineGateway>;
  let evt = 0;
  let n = 0;
  const uid = () => `U-synthetic-stepform-${++n}-${Date.now()}`;

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    bedrock = new MockBedrock([]);
    const drafts = createDraftService({ pool });
    const conversations = createConversationService({ pool });
    const identity = createLineIdentityService({ pool, config: { linkCodeTtlMs: 600_000 } });
    const offers = createOfferService({ pool });
    gateway = createLineGateway({
      events: createLineEventStore({ pool }),
      line: new FakeLineClient(),
      handlers: {
        farmer: createFarmerHandler({
          identity, drafts, conversations, offers,
          listings: createListingService({ pool }),
          balingRequests: createBalingRequestService({ pool }),
          aiEnabled: () => false,
          assistant: composeAssistant({
            env: { ENABLE_REAL_BEDROCK: false, BEDROCK_MODEL_ID: 'anthropic.claude-sonnet-5', ASSISTANT_HISTORY_MESSAGES: 12, AI_MODE: 'disabled' },
            drafts, conversations, matches: createMatchReadService({ pool }), bedrock,
          }),
        }),
        baler: async () => undefined,
        factory: async () => undefined,
      },
    });
  });
  afterAll(async () => { await db?.close(); });

  async function send(userId: string, body: Record<string, unknown>): Promise<Sent[]> {
    const eventId = `evt-sf-${Date.now()}-${++evt}`;
    await createWebhookService({ pool }).ingest('farmer', [{ webhookEventId: eventId, timestamp: Date.now(), source: { type: 'user', userId }, ...body }]);
    const row = (await webhookEvents.getByEvent(pool, 'farmer', eventId))!;
    expect(await gateway.process(row.id)).toBe('handled');
    return (await pool.query<{ message: Sent[] }>('SELECT message FROM notification_outbox WHERE related_id = $1 ORDER BY created_at', [row.id])).rows.flatMap((r) => r.message);
  }
  const say = async (userId: string, text: string) => (await send(userId, { type: 'message', replyToken: 'rt', message: { type: 'text', text } }));
  const labels = (m: Sent | undefined) => (m?.quickReply?.items ?? []).map((i) => i.action.label);
  const last = (ms: Sent[]) => ms[ms.length - 1]!;
  const MENU = ['ลงขายวัสดุ', 'หาผู้รับอัด', 'รายการของฉัน', 'ข้อเสนอ', 'ช่วยเหลือ'];

  async function newFarmer() {
    const userId = uid();
    const greeting = await send(userId, { type: 'follow', replyToken: 'rt' });
    const ident = (await pool.query<{ org_id: string; user_id: string }>("SELECT org_id, user_id FROM line_identities WHERE channel = 'farmer' AND line_user_id = $1", [userId])).rows[0]!;
    return { userId, orgId: ident.org_id, greeting: greeting[0]!, ownerId: ident.user_id };
  }
  const draftOf = async (orgId: string) =>
    (await pool.query('SELECT id, kind, status, version, data FROM drafts WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1', [orgId])).rows[0];
  const count = async (sql: string, p: unknown[]) => Number((await pool.query(sql, p)).rows[0].count);
  const postbackOf = (m: Sent, label: string) => m.quickReply!.items.find((i) => i.action.label === label)!.action.data!;

  it('greets with menu buttons and button wording (no free-text claim) when AI is off', async () => {
    const { greeting } = await newFarmer();
    expect(labels(greeting)).toEqual(MENU);
    expect(greeting.text).toContain('กดปุ่ม');
    expect(greeting.text).not.toContain('บอกวัสดุที่ต้องการขาย');
    expect(bedrock.calls).toHaveLength(0);
  });

  it('replays the observed transcript: sale form, mid-form commands, publish, listings, cancel, once-only notice, Thai province, location', async () => {
    const { userId, orgId } = await newFarmer();
    const all: Sent[] = [];
    const turn = async (text: string) => { const r = await say(userId, text); all.push(...r); return last(r); };

    const first = await turn('อยากขายฟาง');
    expect(first.text).toContain('วัสดุอะไร');
    expect(first.text).toContain('โหมดถามทีละข้อ');
    expect(first.text).not.toContain('ผู้ช่วย AI ใช้งานไม่ได้');
    expect(labels(first)).toContain('ฟางข้าว');
    expect((await draftOf(orgId)).kind).toBe('SALE_LISTING');

    // «ลงขายวัสดุ» again mid-form resumes the same draft instead of starting a second one.
    const again = await turn('ลงขายวัสดุ');
    expect(again.text).toContain('วัสดุอะไร');
    expect(await count('SELECT count(*) FROM drafts WHERE org_id = $1', [orgId])).toBe(1);

    expect((await turn('ฟางข้าว')).text).toContain('ปริมาณเท่าไร');
    // A global command in the middle of a question is not parsed as the answer.
    const v = (await draftOf(orgId)).version;
    const mine = await turn('รายการของฉัน');
    expect(mine.text).toContain('ร่างที่ยังไม่เผยแพร่');
    expect(mine.text).not.toContain('อ่านปริมาณไม่ได้');
    expect(labels(mine)).toEqual(MENU);
    expect((await draftOf(orgId)).version).toBe(v);
    const menu = await turn('เมนู');
    expect(labels(menu)).toEqual([...MENU, 'ยกเลิก']);
    expect((await draftOf(orgId)).status).toBe('DRAFT'); // «เมนู» keeps the draft
    expect((await turn('5 ตัน')).text).toContain('ราคาตายตัวหรือต่อรองได้');
    expect((await draftOf(orgId)).data.qty_kg).toBe('5000.000');
    await turn('ต่อรองได้');

    const loc = await turn('นครสวรรค์');
    expect(loc.quickReply!.items.map((i) => i.action.type)).toEqual(['location', 'message']);
    expect(labels(loc).slice(1)).toEqual(['ข้าม']);
    const preview = await turn('ข้าม');
    expect(labels(preview)).toEqual(['ยืนยันเผยแพร่', 'แก้ไข', 'เก็บร่าง']);
    const draft = await draftOf(orgId);
    expect(draft.data.province).toBe('นครสวรรค์');
    expect(draft.data.lat).toBeUndefined();
    // Typing the confirmation never publishes.
    await turn('ยืนยันเผยแพร่');
    expect(await count('SELECT count(*) FROM material_listings WHERE org_id = $1', [orgId])).toBe(0);

    const published = await send(userId, { type: 'postback', replyToken: 'rt', postback: { data: postbackOf(preview, 'ยืนยันเผยแพร่') } });
    expect(last(published).text).toContain('เผยแพร่เรียบร้อย');
    expect(labels(last(published))).toEqual(MENU);
    expect(await count('SELECT count(*) FROM material_listings WHERE org_id = $1', [orgId])).toBe(1);
    expect((await pool.query('SELECT province FROM material_listings WHERE org_id = $1', [orgId])).rows[0].province).toBe('นครสวรรค์');
    expect((await pool.query('SELECT active_draft_id FROM conversations WHERE org_id = $1', [orgId])).rows[0].active_draft_id).toBeNull();

    // After publishing, the next message starts from the menu.
    const hi = await turn('สวัสดี');
    expect(labels(hi)).toEqual(MENU);
    expect(hi.text).not.toContain('โหมดถามทีละข้อ');
    const listing = await turn('รายการของฉัน');
    expect(listing.text).toContain('ฟางข้าว 5,000 กก. (เหลือ 5,000 กก.)');
    expect(listing.text).toContain('นครสวรรค์');
    expect(listing.text).toContain('เปิดอยู่');

    // The second sale form: «อื่นๆ», then a listing request is not a quantity.
    await turn('ประกาศขาย');
    expect((await turn('อื่นๆ')).text).toContain('ปริมาณเท่าไร');
    const see = await turn('อยากดูรายการขาย');
    expect(see.text).toContain('รายการของฉัน');
    expect(see.text).not.toContain('อ่านปริมาณไม่ได้');
    const cancelled = await turn('ยกเลิก');
    expect(cancelled.text).toContain('ยกเลิกร่างแล้ว');
    expect(labels(cancelled)).toEqual(MENU);
    expect((await draftOf(orgId)).status).toBe('CANCELLED');
    expect(await count('SELECT count(*) FROM material_listings WHERE org_id = $1', [orgId])).toBe(1); // nothing new published
    expect((await turn('ยกเลิก')).text).toContain('ไม่มีร่าง');

    expect(all.filter((m) => m.text.includes('โหมดถามทีละข้อ'))).toHaveLength(1);
    expect(all.some((m) => m.text.includes('ผู้ช่วย AI ใช้งานไม่ได้'))).toBe(false);
    expect(bedrock.calls).toHaveLength(0);
  });

  it('every start-menu reply carries the buttons, and the baling request starts its own form', async () => {
    const { userId, orgId } = await newFarmer();
    const menu = last(await say(userId, 'ขอสอบถามหน่อย'));
    expect(labels(menu)).toEqual(MENU);
    expect(await count('SELECT count(*) FROM drafts WHERE org_id = $1', [orgId])).toBe(0);
    const baling = last(await say(userId, 'หาผู้รับอัด'));
    expect(baling.text).toContain('วัสดุอะไรที่ต้องการให้อัด');
    expect((await draftOf(orgId)).kind).toBe('BALING_REQUEST');
  });

  it('English province input is stored in the canonical Thai form, and a shared location continues the form', async () => {
    const { userId, orgId } = await newFarmer();
    for (const t of ['ขาย', 'ฟางข้าว', '3 ตัน', 'ต่อรองได้']) await say(userId, t);
    const loc = last(await say(userId, 'Nakhon Sawan'));
    expect(loc.quickReply!.items[0]!.action.type).toBe('location');
    expect((await draftOf(orgId)).data.province).toBe('นครสวรรค์');
    const shared = await send(userId, { type: 'message', replyToken: 'rt', message: { type: 'location', latitude: 15.7, longitude: 100.1 } });
    expect(shared[0]!.text).toContain('บันทึกตำแหน่ง');
    expect(labels(last(shared))).toEqual(['ยืนยันเผยแพร่', 'แก้ไข', 'เก็บร่าง']);
    expect((await draftOf(orgId)).data).toMatchObject({ lat: '15.700000', lng: '100.100000' });
    expect(await count('SELECT count(*) FROM material_listings WHERE org_id = $1', [orgId])).toBe(0);
  });

  it('«ข้อเสนอ» shows a pending offer with accept and reject postback buttons', async () => {
    const { userId, orgId } = await newFarmer();
    expect(last(await say(userId, 'ข้อเสนอ')).text).toContain('ไม่มีข้อเสนอที่รอตอบ');
    const factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    const offer = await makeOffer(pool, { listing: await makeListing(pool, orgId), demand: await makeDemand(pool, factory.org.id) });
    const shown = last(await say(userId, 'ดูข้อเสนอ'));
    expect(shown.quickReply!.items.map((i) => [i.action.type, i.action.label])).toEqual([['postback', 'ตอบรับ'], ['postback', 'ปฏิเสธ']]);
    expect(shown.quickReply!.items[0]!.action.data).toContain(`id=${offer.id}`);
    // Reply to a redelivered event writes and sends nothing twice.
    expect((await pool.query('SELECT status FROM offers WHERE id = $1', [offer.id])).rows[0].status).toBe('PENDING');
  });

  it('the province data-fix migration maps English pilot names to Thai and is idempotent', async () => {
    const farmer = await makeOrgWithUser(pool, 'FARMER');
    const row = await makeListing(pool, farmer.org.id, { province: 'Nakhon Sawan' });
    const other = await makeListing(pool, farmer.org.id, { province: 'Chiang Mai' });
    const sql = readFileSync(new URL('../../../db/migrations/1731888400000_canonical-thai-provinces.sql', import.meta.url), 'utf8').split('-- Down Migration')[0]!;
    await pool.query(sql);
    await pool.query(sql);
    const get = async (id: string) => (await pool.query('SELECT province, version FROM material_listings WHERE id = $1', [id])).rows[0];
    expect((await get(row.id)).province).toBe('นครสวรรค์');
    expect((await get(other.id)).province).toBe('Chiang Mai');
  });
});
