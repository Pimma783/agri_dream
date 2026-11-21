// Task 10.5: degraded step-form mode against real Postgres services, MockBedrock only (no AWS call).
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockBedrock, type MockStep } from '../src/adapters/bedrock/test-support.js';
import type { Actor, Role } from '../src/domain/permissions.js';
import { createAssistant, createStepForm, type AssistantReply } from '../src/assistant/index.js';
import { createConversationService, createDraftService, type ConversationService, type DraftService } from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeOrgWithUser } from './factories.js';

const MODEL = 'anthropic.claude-sonnet-5';
const NOW = new Date('2026-03-05T03:00:00Z'); // 2026-03-05 10:00 in Bangkok

describe.skipIf(!testDatabaseUrl)('degraded step form (real services, MockBedrock)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let drafts: DraftService;
  let conversations: ConversationService;

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    drafts = createDraftService({ pool });
    conversations = createConversationService({ pool });
  });
  afterAll(async () => {
    await db?.close();
  });

  async function actorOf(role: Role): Promise<Actor> {
    const { org, user } = await makeOrgWithUser(pool, role);
    return { userId: user.id, orgId: org.id, role, channel: role === 'FARMER' ? 'line:farmer' : role === 'BALER' ? 'line:baler' : 'line:factory' };
  }
  /** `script` is what Bedrock would do. With `aiOff` the model is not even asked. */
  function chat(script: MockStep[], aiOff = false) {
    const bedrock = new MockBedrock(script);
    const assistant = createAssistant({
      bedrock, modelId: MODEL, drafts, conversations,
      ...(aiOff ? { aiEnabled: () => false } : {}),
      degraded: createStepForm({ drafts, conversations, clock: { now: () => NOW } }),
    });
    const say = async (actor: Actor, text: string): Promise<AssistantReply> => {
      const r = await assistant.handle(actor, { text });
      if (!r.ok || r.value === null) throw new Error('no reply');
      return r.value;
    };
    return { bedrock, say };
  }
  const draftRow = async (orgId: string) =>
    (await pool.query('SELECT id, kind, status, version, data FROM drafts WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1', [orgId])).rows[0];
  const count = async (table: string, orgId: string) =>
    Number((await pool.query(`SELECT count(*) FROM ${table} WHERE org_id = $1`, [orgId])).rows[0].count);

  it('fills a sale listing step by step with the model switched off, refuses เกวียน, and never publishes', async () => {
    const farmer = await actorOf('FARMER');
    const { bedrock, say } = chat([{ type: 'text', text: 'unused' }], true);

    // Farmer may start a sale or a baling request: asks which.
    const menu = await say(farmer, 'สวัสดี');
    expect(menu.degraded).toBe(true);
    expect(menu.tool).toBe('degraded');
    // Old expectation was the two draft-kind labels; the farmer menu is now the five main-menu buttons.
    expect(menu.quickReplies).toEqual(['ลงขายวัสดุ', 'หาผู้รับอัด', 'รายการของฉัน', 'ข้อเสนอ', 'ช่วยเหลือ']);
    expect(menu.text).toContain('โหมดถามทีละข้อ');
    expect(await count('drafts', farmer.orgId)).toBe(0);

    const first = await say(farmer, 'ประกาศขาย');
    expect(first.text).toContain('วัสดุอะไร');
    expect(first.quickReplies).toContain('ฟางข้าว');
    expect(first.draft?.kind).toBe('SALE_LISTING');

    const q = await say(farmer, 'ฟางข้าว');
    expect(q.text).toContain('ปริมาณเท่าไร');
    const v1 = (await draftRow(farmer.orgId)).version;

    // Unparseable, then a local unit: nothing is written and the same question is asked again.
    const noNumber = await say(farmer, 'เยอะมาก');
    expect(noNumber.noWrite).toBe(true);
    expect(noNumber.text).toContain('ปริมาณเท่าไร');
    const local = await say(farmer, 'ประมาณ 10 เกวียน');
    expect(local.noWrite).toBe(true);
    expect(local.text).toContain('กิโลกรัม (กก.) หรือตัน');
    expect(local.text).toContain('ปริมาณเท่าไร');
    expect((await draftRow(farmer.orgId)).version).toBe(v1);
    expect((await draftRow(farmer.orgId)).data.qty_kg).toBeUndefined();

    expect((await say(farmer, '5 ตัน')).quickReplies).toEqual(['ราคาตายตัว', 'ต่อรองได้']);
    expect((await draftRow(farmer.orgId)).data.qty_kg).toBe('5000.000');
    const price = await say(farmer, 'ราคาตายตัว');
    expect(price.text).toContain('ราคาที่ขายเท่าไร');
    const unitless = await say(farmer, '2 บาท');
    expect(unitless.noWrite).toBe(true);
    expect(unitless.text).toContain('ราคาที่ขายเท่าไร');
    expect((await say(farmer, '2 บาท/กก.')).text).toContain('จังหวัดไหน');

    // The province is followed by the optional location question (not confirmable yet); «ข้าม» goes on to the review.
    const loc = await say(farmer, 'จ.อุตรดิตถ์');
    expect(loc.confirmable).toBe(false);
    expect(loc.requestLocation).toBe(true);
    expect(loc.quickReplies).toEqual(['ข้าม']);
    const done = await say(farmer, 'ข้าม');
    expect(done.text).not.toContain('โหมดถามทีละข้อ'); // the notice is shown once per conversation
    expect(done.confirmable).toBe(true);
    expect(done.draft).toMatchObject({ complete: true, status: 'AWAITING_REVIEW' });
    expect(done.preview?.actions.map((a) => a.label)).toEqual(['ยืนยันเผยแพร่', 'แก้ไข', 'เก็บร่าง']);
    expect(done.preview?.rows).toContainEqual({ label: 'ปริมาณ', value: '5,000 กก.' });
    expect(done.preview?.rows).toContainEqual({ label: 'จังหวัด', value: 'อุตรดิตถ์' });
    expect(done.text).toContain('ยังไม่ได้เผยแพร่');
    const row = await draftRow(farmer.orgId);
    expect(row.data).toMatchObject({ material_type: 'RICE_STRAW', qty_kg: '5000.000', unit_price_thb: '2.0000', price_unit: 'KG', province: 'อุตรดิตถ์' });
    expect(row.data.lat).toBeUndefined(); // skipped: no coordinates are invented

    // Typing the confirmation does not publish; only the channel button does.
    const typed = await say(farmer, 'ยืนยันเผยแพร่');
    expect(typed.text).toContain('กดปุ่ม');
    expect((await draftRow(farmer.orgId)).status).toBe('AWAITING_REVIEW');
    expect(await count('material_listings', farmer.orgId)).toBe(0);

    // Edit one field through the menu: the draft goes back through the service with expectedVersion.
    const menu2 = await say(farmer, 'แก้ไข');
    expect(menu2.quickReplies).toEqual(expect.arrayContaining(['ปริมาณ', 'ราคา', 'จังหวัด', 'พร้อมขายเริ่ม']));
    expect((await say(farmer, 'ปริมาณ')).text).toContain('ปริมาณเท่าไร');
    const edited = await say(farmer, '3 ตัน');
    expect(edited.preview?.rows).toContainEqual({ label: 'ปริมาณ', value: '3,000 กก.' });
    expect((await draftRow(farmer.orgId)).version).toBeGreaterThan(row.version);

    // Switching to NEGOTIABLE drops the price and the price question disappears from the form.
    await say(farmer, 'แก้ไข');
    await say(farmer, 'รูปแบบราคา');
    const neg = await say(farmer, 'ต่อรองได้');
    expect(neg.confirmable).toBe(true);
    expect((await draftRow(farmer.orgId)).data.unit_price_thb).toBeUndefined();

    expect((await say(farmer, 'เก็บร่าง')).text).toContain('เก็บร่างไว้แล้ว');
    expect(bedrock.calls).toHaveLength(0);
    const log = await pool.query("SELECT channel FROM audit_logs WHERE entity_id = $1 AND action = 'draft.patched'", [row.id]);
    expect(log.rows.length).toBeGreaterThan(0);
    expect(log.rows.every((r) => r.channel === 'assistant')).toBe(true);
  });

  it('resolves dates with the injected clock in Asia/Bangkok and asks again when ambiguous', async () => {
    const farmer = await actorOf('FARMER');
    const { say } = chat([{ type: 'text', text: 'unused' }], true);
    await say(farmer, 'ประกาศขาย');
    for (const a of ['ฟางข้าว', '5 ตัน', 'ต่อรองได้', 'นครสวรรค์']) await say(farmer, a);
    expect((await draftRow(farmer.orgId)).status).toBe('AWAITING_REVIEW');

    await say(farmer, 'แก้ไข');
    await say(farmer, 'พร้อมขายเริ่ม');
    const from = await say(farmer, 'พรุ่งนี้');
    expect(from.preview?.rows).toContainEqual({ label: 'พร้อมขายเริ่ม', value: '2026-03-06' });
    expect((await draftRow(farmer.orgId)).data.available_from).toBe('2026-03-05T17:00:00.000Z');

    await say(farmer, 'แก้ไข');
    await say(farmer, 'พร้อมขายสิ้นสุด');
    const v = (await draftRow(farmer.orgId)).version;
    const amb = await say(farmer, '05/04/2026');
    expect(amb.noWrite).toBe(true);
    expect(amb.text).toContain('วันที่ยังไม่ชัดเจน');
    expect(amb.text).toContain('พร้อมขายสิ้นสุดวันที่เท่าไร');
    const before = await say(farmer, '2026-03-01');
    expect(before.text).toContain('ผ่านมาแล้ว');
    const order = await say(farmer, 'วันนี้'); // today is before the start date (tomorrow)
    expect(order.noWrite).toBe(true);
    expect(order.text).toContain('ไม่ก่อนวันเริ่ม');
    expect((await draftRow(farmer.orgId)).version).toBe(v);
    const ok = await say(farmer, '2026-04-20');
    expect(ok.preview?.rows).toContainEqual({ label: 'พร้อมขายสิ้นสุด', value: '2026-04-20' });
    expect((await draftRow(farmer.orgId)).data.available_to).toBe('2026-04-20T16:59:59.000Z');
  });

  it.each([
    ['timeout', { type: 'timeout' } as MockStep],
    ['throttled after retries', { type: 'throttled' } as MockStep],
  ])('switches to the form when Bedrock fails (%s), and continues the same draft', async (_n, step) => {
    const farmer = await actorOf('FARMER');
    const { bedrock, say } = chat([step]);
    const a = await say(farmer, 'ประกาศขาย');
    expect(a).toMatchObject({ degraded: true, tool: 'degraded' });
    expect(a.text).toContain('วัสดุอะไร');
    expect(bedrock.calls.length).toBeGreaterThan(0);
    const b = await say(farmer, 'ซังข้าวโพด');
    expect(b.degraded).toBe(true);
    expect(b.text).toContain('ปริมาณเท่าไร');
    expect(await count('drafts', farmer.orgId)).toBe(1);
    expect((await draftRow(farmer.orgId)).data.material_type).toBe('CORN_COB');
  });

  it('completes a purchase demand for a factory (single allowed kind starts at once)', async () => {
    const factory = await actorOf('BUYER_FACTORY');
    const { say } = chat([{ type: 'timeout' }]);
    const start = await say(factory, 'อยากรับซื้อ');
    expect(start.draft?.kind).toBe('PURCHASE_DEMAND');
    expect(start.text).toContain('รับซื้อวัสดุอะไร');
    await say(factory, 'ฟางข้าว, ใบอ้อย');
    expect((await draftRow(factory.orgId)).data.accepted_materials.sort()).toEqual(['CANE_LEAF', 'RICE_STRAW']);
    expect((await say(factory, '2 เกวียน')).noWrite).toBe(true);
    await say(factory, '20 ตัน');
    await say(factory, 'ราคาตายตัว');
    const p = await say(factory, '1800 บาท/ตัน');
    expect(p.text).toContain('จังหวัดไหน');
    expect((await say(factory, 'กำแพงเพชร')).requestLocation).toBe(true);
    const done = await say(factory, 'ข้าม');
    expect(done.confirmable).toBe(true);
    expect((await draftRow(factory.orgId)).data).toMatchObject({
      target_qty_kg: '20000.000', max_unit_price_thb: '1800.0000', price_unit: 'TON', province: 'กำแพงเพชร',
    });
    expect(await count('purchase_demands', factory.orgId)).toBe(0);
  });

  it('completes a baling service (price per bale) and a baling request', async () => {
    const baler = await actorOf('BALER');
    const { say } = chat([{ type: 'malformed_json' }], true);
    expect((await say(baler, 'เริ่ม')).quickReplies).toEqual(['ประกาศขาย', 'ประกาศรับซื้อ', 'บริการอัดฟาง']);
    await say(baler, 'บริการอัดฟาง');
    await say(baler, 'ทุกชนิด');
    await say(baler, 'ที่แปลง');
    await say(baler, 'ราคาตายตัว');
    expect((await say(baler, '80 บาท/มัด')).text).toContain('จังหวัดไหน');
    expect((await say(baler, 'นครสวรรค์')).requestLocation).toBe(true);
    const done = await say(baler, 'ข้าม');
    expect(done.confirmable).toBe(true);
    expect((await draftRow(baler.orgId)).data).toMatchObject({ unit_price_thb: '80.0000', price_unit: 'BALE', service_mode: 'ON_SITE' });

    const farmer = await actorOf('FARMER');
    await say(farmer, 'คำขอให้อัดฟาง');
    await say(farmer, 'ฟางข้าว');
    expect((await say(farmer, '3 ไร่')).noWrite).toBe(true);
    await say(farmer, '3000 กก.');
    await say(farmer, 'ที่โรงงาน');
    expect((await say(farmer, 'อุตรดิตถ์')).requestLocation).toBe(true);
    const req = await say(farmer, 'ข้าม');
    expect(req.confirmable).toBe(true);
    expect((await draftRow(farmer.orgId)).data).toMatchObject({ qty_kg: '3000.000', requested_mode: 'AT_FACTORY', province: 'อุตรดิตถ์' });
    expect(await count('baling_requests', farmer.orgId)).toBe(0);
  });

  it('asks again on an unknown province and an unclear choice, writing nothing', async () => {
    const factory = await actorOf('BUYER_FACTORY');
    const { say } = chat([{ type: 'timeout' }]);
    await say(factory, 'เริ่ม');
    for (const a of ['ฟางข้าว', '10 ตัน', 'ต่อรองได้']) await say(factory, a);
    const v = (await draftRow(factory.orgId)).version;
    const p = await say(factory, 'เชียงใหม่');
    expect(p.noWrite).toBe(true);
    expect(p.text).toContain('จังหวัดไหน');
    expect(p.quickReplies).toEqual(['อุตรดิตถ์', 'นครสวรรค์', 'กำแพงเพชร']);
    expect((await draftRow(factory.orgId)).version).toBe(v);
  });

  it('does not reach into another organization\'s draft', async () => {
    const a = await actorOf('FARMER');
    const b = await actorOf('FARMER');
    const { say } = chat([{ type: 'timeout' }]);
    await say(a, 'ประกาศขาย');
    const draftA = await draftRow(a.orgId);
    const cb = await conversations.open(b);
    if (!cb.ok) throw new Error('setup');
    await pool.query('UPDATE conversations SET active_draft_id = $1 WHERE id = $2', [draftA.id, cb.value.id]);
    const r = await say(b, 'ฟางข้าว');
    expect(r.quickReplies).toEqual(['ลงขายวัสดุ', 'หาผู้รับอัด', 'รายการของฉัน', 'ข้อเสนอ', 'ช่วยเหลือ']); // starts fresh, A's draft untouched
    expect((await draftRow(a.orgId)).version).toBe(draftA.version);
  });
});
