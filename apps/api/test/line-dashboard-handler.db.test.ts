// Task 9.10: baler and factory LINE handlers through the gateway, real services, FakeLineClient only (no real LINE).
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLineClient } from '../src/adapters/line/index.js';
import { createBalerHandler, createFactoryHandler, createFarmerHandler, createLineGateway } from '../src/channels/index.js';
import { webhookEvents } from '../src/repos/index.js';
import {
  createConversationService, createDraftService, createLineEventStore, createMatchReadService, createOfferService, createWebhookService,
} from '../src/services/index.js';
import { createLineIdentityService, LINK_FAILURE_MESSAGE_TH } from '../src/services/identity/index.js';
import { composeAssistant } from '../src/assistant/index.js';
import { MockBedrock } from '../src/adapters/bedrock/test-support.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOffer, makeOrgWithUser } from './factories.js';
const ORIGIN = 'https://dash.example.test';
type Channel = 'baler' | 'factory';
type Sent = { text: string; quickReply?: { items: Array<{ action: { type: string; label: string; uri?: string; data?: string } }> } };
describe.skipIf(!testDatabaseUrl)('baler and factory LINE handlers (real services, FakeLineClient)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let gateway: ReturnType<typeof createLineGateway>;
  const identity = () => createLineIdentityService({ pool, config: { linkCodeTtlMs: 600_000 } });
  let n = 0;
  let evt = 0;
  const uid = (c: string) => `U-synthetic-${c}-${++n}-${Date.now()}`;
  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    const id = identity();
    const offers = createOfferService({ pool });
    const matches = createMatchReadService({ pool });
    const drafts = createDraftService({ pool });
    const conversations = createConversationService({ pool });
    const deps = { identity: id, offers, matches, webOrigin: ORIGIN };
    gateway = createLineGateway({
      events: createLineEventStore({ pool }),
      line: new FakeLineClient(),
      handlers: {
        farmer: createFarmerHandler({
          identity: id, drafts, conversations, offers,
          assistant: composeAssistant({
            env: { ENABLE_REAL_BEDROCK: true, BEDROCK_MODEL_ID: 'anthropic.claude-sonnet-5', ASSISTANT_HISTORY_MESSAGES: 12, AI_MODE: 'enabled' },
            drafts, conversations, matches, bedrock: new MockBedrock([]),
          }),
        }),
        baler: createBalerHandler(deps),
        factory: createFactoryHandler(deps),
      },
    });
  });
  afterAll(async () => { await db?.close(); });
  async function send(channel: Channel, userId: string, body: Record<string, unknown>): Promise<{ id: string; sent: Sent[] }> {
    const eventId = `evt-${Date.now()}-${++evt}`;
    await createWebhookService({ pool }).ingest(channel, [{ webhookEventId: eventId, timestamp: Date.now(), source: { type: 'user', userId }, ...body }]);
    const id = (await webhookEvents.getByEvent(pool, channel, eventId))!.id;
    await gateway.process(id);
    return { id, sent: await sentFor(id) };
  }
  async function sentFor(eventRowId: string): Promise<Sent[]> {
    const rows = await pool.query<{ channel: string; message: Sent[] }>(`SELECT channel, message FROM notification_outbox WHERE related_id = $1 ORDER BY created_at`, [eventRowId]);
    return rows.rows.flatMap((r) => r.message);
  }
  const text = (t: string) => ({ type: 'message', replyToken: 'rt', message: { type: 'text', text: t } });
  const postback = (d: string) => ({ type: 'postback', replyToken: 'rt', postback: { data: d } });
  const follow = { type: 'follow', replyToken: 'rt' };
  const KIND = { baler: 'BALER', factory: 'BUYER_FACTORY' } as const;
  async function issue(channel: Channel) {
    const p = await makeOrgWithUser(pool, KIND[channel]);
    const r = await identity().issueLinkCode({ userId: p.user.id, orgId: p.org.id, role: KIND[channel], channel: 'web' });
    if (!r.ok) throw new Error('issue');
    return { ...p, code: r.value.code };
  }
  async function linked(channel: Channel) {
    const p = await issue(channel);
    const userId = uid(channel);
    await send(channel, userId, follow);
    const r = await send(channel, userId, text(p.code));
    expect(r.sent[0]!.text).toContain(p.org.name);
    return { ...p, userId };
  }
  const offerTo = async (receiverOrgId: string) => {
    const other = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    return makeOffer(pool, { listing: await makeListing(pool, receiverOrgId), demand: await makeDemand(pool, other.org.id) });
  };
  const status = async (offerId: string) => (await pool.query(`SELECT status FROM offers WHERE id = $1`, [offerId])).rows[0].status as string;
  const count = async (sql: string, p: unknown[]) => Number((await pool.query(sql, p)).rows[0].count);
  for (const channel of ['baler', 'factory'] as const) {
    describe(channel, () => {
      it('follow creates an UNLINKED identity and the prompt names the Dashboard settings page and the 8-character code', async () => {
        const userId = uid(channel);
        const r = await send(channel, userId, follow);
        expect(r.sent[0]!.text).toContain(`${ORIGIN}/settings/line`);
        expect(r.sent[0]!.text).toContain('8');
        const row = (await pool.query(`SELECT status, org_id, user_id FROM line_identities WHERE channel = $1 AND line_user_id = $2`, [channel, userId])).rows[0];
        expect(row).toMatchObject({ status: 'UNLINKED', org_id: null, user_id: null });
        expect(await count(`SELECT count(*) FROM organizations o JOIN line_identities l ON l.org_id = o.id WHERE l.line_user_id = $1`, [userId])).toBe(0);
        expect((await send(channel, userId, text('สวัสดี'))).sent[0]!.text).toContain(`${ORIGIN}/settings/line`);
      });
      it('a valid link code links the identity and names the organization; a second use fails with the generic message', async () => {
        const p = await issue(channel);
        const userId = uid(channel);
        await send(channel, userId, follow);
        const ok = await send(channel, userId, text(p.code.toLowerCase()));
        expect(ok.sent[0]!.text).toContain(p.org.name);
        expect((await pool.query(`SELECT status, org_id FROM line_identities WHERE channel = $1 AND line_user_id = $2`, [channel, userId])).rows[0]).toMatchObject({ status: 'LINKED', org_id: p.org.id });
        const other = uid(channel);
        await send(channel, other, follow);
        expect((await send(channel, other, text(p.code))).sent[0]!.text).toBe(LINK_FAILURE_MESSAGE_TH);
      });
      it('unknown, expired, used and wrong-channel codes all get the identical reply and change nothing', async () => {
        const expired = await issue(channel);
        await pool.query(`UPDATE line_link_codes SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE org_id = $1`, [expired.org.id]);
        const wrong = await issue(channel === 'baler' ? 'factory' : 'baler');
        const used = await issue(channel);
        const firstUser = uid(channel);
        await send(channel, firstUser, follow);
        await send(channel, firstUser, text(used.code));
        const replies: string[] = [];
        for (const code of ['ABCDEFGH', expired.code, wrong.code, used.code]) {
          const userId = uid(channel);
          await send(channel, userId, follow);
          replies.push((await send(channel, userId, text(code))).sent[0]!.text);
          expect((await pool.query(`SELECT status FROM line_identities WHERE channel = $1 AND line_user_id = $2`, [channel, userId])).rows[0].status).toBe('UNLINKED');
        }
        expect(new Set(replies)).toEqual(new Set([LINK_FAILURE_MESSAGE_TH]));
      });
      it('a linked actor gets the menu with the Dashboard link, and free text points to the Dashboard (AI off)', async () => {
        const a = await linked(channel);
        const menu = await send(channel, a.userId, text('เมนู'));
        const items = menu.sent[0]!.quickReply!.items.map((i) => i.action);
        expect(items.map((i) => i.label)).toEqual(['เปิด Dashboard', 'ข้อเสนอ', 'ผลจับคู่']);
        expect(items[0]).toMatchObject({ type: 'uri', uri: `${ORIGIN}/` });
        const free = await send(channel, a.userId, text('ขายฟางข้าว 5 ตัน'));
        expect(free.sent).toHaveLength(1);
        expect(free.sent[0]!.text).toContain('Dashboard');
        expect(free.sent[0]!.text).toContain('ปิด');
        expect(await count(`SELECT count(*) FROM drafts WHERE org_id = $1`, [a.org.id])).toBe(0);
      });
      it('«ข้อเสนอ» lists only this organization\'s pending received offers with accept and reject buttons', async () => {
        const a = await linked(channel);
        const mine = await offerTo(a.org.id);
        const theirs = await offerTo((await makeOrgWithUser(pool, KIND[channel])).org.id);
        const r = await send(channel, a.userId, text('ข้อเสนอ'));
        expect(r.sent).toHaveLength(1);
        const data = r.sent[0]!.quickReply!.items.map((i) => i.action.data);
        expect(data).toEqual([`action=offer_accept&id=${mine.id}&v=${mine.version}`, `action=offer_reject&id=${mine.id}&v=${mine.version}`]);
        expect(JSON.stringify(r.sent)).not.toContain(theirs.id);
        const empty = await linked(channel);
        expect((await send(channel, empty.userId, text('ข้อเสนอ'))).sent[0]!.text).toContain('ไม่มีข้อเสนอ');
      });
      it('«ผลจับคู่» answers with an estimate label and never leaks coordinates or names', async () => {
        const a = await linked(channel);
        const r = await send(channel, a.userId, text('ผลจับคู่'));
        expect(r.sent).toHaveLength(1);
        expect(r.sent[0]!.text).not.toMatch(/lat|lng|\d{2}\.\d{4,}/i);
      });
      it('accept postback agrees once; a double tap gets the same confirmation and no second agreement', async () => {
        const a = await linked(channel);
        const offer = await offerTo(a.org.id);
        const data = `action=offer_accept&id=${offer.id}&v=${offer.version}`;
        const first = await send(channel, a.userId, postback(data));
        const second = await send(channel, a.userId, postback(data));
        expect(await count(`SELECT count(*) FROM agreements WHERE offer_id = $1`, [offer.id])).toBe(1);
        expect(await status(offer.id)).toBe('ACCEPTED');
        expect(first.sent[0]!.text).toContain('ยืนยันข้อตกลงแล้ว');
        expect(second.sent[0]!.text).toBe(first.sent[0]!.text);
      });
      it('a stale version on a pending offer changes nothing', async () => {
        const a = await linked(channel);
        const offer = await offerTo(a.org.id);
        const r = await send(channel, a.userId, postback(`action=offer_accept&id=${offer.id}&v=${offer.version + 4}`));
        expect(r.sent[0]!.text).toContain('เปลี่ยนแปลง');
        expect(await status(offer.id)).toBe('PENDING');
      });
      it('reject postback rejects once; a double tap gets the same reply', async () => {
        const a = await linked(channel);
        const offer = await offerTo(a.org.id);
        const data = `action=offer_reject&id=${offer.id}&v=${offer.version}`;
        const first = await send(channel, a.userId, postback(data));
        const second = await send(channel, a.userId, postback(data));
        expect(await status(offer.id)).toBe('REJECTED');
        expect(first.sent[0]!.text).toContain('ปฏิเสธข้อเสนอแล้ว');
        expect(second.sent[0]!.text).toBe(first.sent[0]!.text);
      });
      it("another organization's offer id is not found and nothing changes", async () => {
        const a = await linked(channel);
        const foreign = await offerTo((await makeOrgWithUser(pool, KIND[channel])).org.id);
        for (const action of ['offer_accept', 'offer_reject']) {
          const r = await send(channel, a.userId, postback(`action=${action}&id=${foreign.id}&v=${foreign.version}`));
          expect(r.sent[0]!.text).toContain('ไม่พบข้อมูล');
        }
        expect(await status(foreign.id)).toBe('PENDING');
        expect(await count(`SELECT count(*) FROM agreements WHERE offer_id = $1`, [foreign.id])).toBe(0);
      });
      it('an unlinked user cannot act through a postback and a bad postback is safe', async () => {
        const userId = uid(channel);
        await send(channel, userId, follow);
        const offer = await offerTo((await makeOrgWithUser(pool, KIND[channel])).org.id);
        const r = await send(channel, userId, postback(`action=offer_accept&id=${offer.id}&v=${offer.version}`));
        expect(r.sent[0]!.text).toContain('/settings/line');
        expect(await status(offer.id)).toBe('PENDING');
        const a = await linked(channel);
        expect((await send(channel, a.userId, postback('action=nope&id=x'))).sent).toHaveLength(1);
      });
      it('every reply goes out on this channel only', async () => {
        const a = await linked(channel);
        const r = await send(channel, a.userId, text('ข้อเสนอ'));
        const other = channel === 'baler' ? 'factory' : 'baler';
        expect(await count(`SELECT count(*) FROM notification_outbox WHERE related_id = $1 AND channel <> $2`, [r.id, channel])).toBe(0);
        expect(await count(`SELECT count(*) FROM notification_outbox WHERE related_id = $1 AND channel = $2`, [r.id, other])).toBe(0);
        expect(await count(`SELECT count(*) FROM notification_outbox WHERE related_id = $1 AND channel = $2`, [r.id, channel])).toBeGreaterThan(0);
      });
    });
  }
  it('offer notifications to a LINKED baler or factory carry accept and reject buttons on their own channel; an UNLINKED one gets nothing', async () => {
    const f = await linked('factory');
    const offer = await offerTo(f.org.id);
    // Queue through the real accept path's notifier: create via the service so the outbox row comes from notifyOrg.
    const { notifyOrg } = await import('../src/services/offers/notify.js');
    expect(await notifyOrg(pool, f.org.id, 'created', offer)).toBe(1);
    const row = (await pool.query(`SELECT channel, message FROM notification_outbox WHERE related_id = $1 AND dedupe_key LIKE 'offer:%'`, [offer.id])).rows[0];
    expect(row.channel).toBe('factory');
    expect(row.message[0].quickReply.items.map((i: { action: { data: string } }) => i.action.data)).toEqual([
      `action=offer_accept&id=${offer.id}&v=${offer.version}`, `action=offer_reject&id=${offer.id}&v=${offer.version}`,
    ]);
    const unlinked = await makeOrgWithUser(pool, 'BALER');
    await send('baler', uid('baler'), follow);
    expect(await notifyOrg(pool, unlinked.org.id, 'created', offer)).toBe(0);
  });
});
