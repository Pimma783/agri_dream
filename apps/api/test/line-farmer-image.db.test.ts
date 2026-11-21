// Task 13.3: farmer LINE image path through the gateway. Real Postgres services, FakeLineClient and MockBedrock only.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLineClient } from '../src/adapters/line/index.js';
import { MockBedrock, type MockStep } from '../src/adapters/bedrock/test-support.js';
import { composeAssistant, createImageAssessor } from '../src/assistant/index.js';
import {
  createFarmerHandler, createFarmerImageHook, createLineGateway, FARMER_IMAGE_TEXT,
} from '../src/channels/index.js';
import { HandlerRegistry, JobRunner, registerAssessImage } from '../src/jobs/index.js';
import { webhookEvents } from '../src/repos/index.js';
import {
  ASSESSMENT_DISCLAIMER_TH, createAssessmentService, createConversationService, createDraftService, createJobQueue,
  createLineEventStore, createMatchReadService, createOfferService, createWebhookService,
} from '../src/services/index.js';
import { createLineIdentityService } from '../src/services/identity/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeImageBytes } from './factories.js';

const sellTurn: MockStep = {
  type: 'json',
  value: { intent: 'SELL_MATERIAL', reply_text: 'รับทราบ', draft_patch: { kind: 'SALE_LISTING', fields: { material_type: 'RICE_STRAW' } } },
};

describe.skipIf(!testDatabaseUrl)('farmer LINE image path (fakes for LINE and Bedrock)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  const line = new FakeLineClient();
  let gateway: ReturnType<typeof createLineGateway>;
  const webhooks = () => createWebhookService({ pool });
  let n = 0;
  const uid = () => `U-synthetic-img-${++n}-${Date.now()}`;

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    const drafts = createDraftService({ pool });
    const conversations = createConversationService({ pool });
    const identity = createLineIdentityService({ pool, config: { linkCodeTtlMs: 600_000 } });
    const bedrock = new MockBedrock([sellTurn]);
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
          onImage: createFarmerImageHook({
            getContent: async (id) => (await line.forChannel('farmer').getContent?.(id)) ?? { ok: false, code: 'INVALID_REQUEST' },
            assessment: createAssessmentService({ pool, queue: createJobQueue(pool), secret: 'test-secret', ttlSeconds: 60 }),
            drafts, conversations,
          }),
        }),
        // Only farmer events are processed here; the other channels are not part of this task.
        baler: async () => {},
        factory: async () => {},
      },
    });
  });
  afterAll(async () => { await db?.close(); });

  let evt = 0;
  async function store(userId: string, body: Record<string, unknown>) {
    const eventId = `evt-img-${Date.now()}-${++evt}`;
    await webhooks().ingest('farmer', [{ webhookEventId: eventId, timestamp: Date.now(), source: { type: 'user', userId }, ...body }]);
    return (await webhookEvents.getByEvent(pool, 'farmer', eventId))!.id;
  }
  const imageEvt = (id: string) => ({ type: 'message', replyToken: 'rt', message: { type: 'image', id } });
  const pushText = async (eventRow: string) =>
    (await pool.query<{ message: Array<{ text: string }> }>(`SELECT message FROM notification_outbox WHERE related_id = $1`, [eventRow])).rows
      .flatMap((r) => r.message).map((m) => m.text).join('\n');
  const count = async (sql: string, params: unknown[]) => Number((await pool.query(sql, params)).rows[0].count);

  async function farmerWithDraft(withDraft = true) {
    const userId = uid();
    await gateway.process(await store(userId, { type: 'follow', replyToken: 'rt' }));
    if (withDraft) await gateway.process(await store(userId, { type: 'message', message: { type: 'text', text: 'ขายฟางข้าว' } }));
    const { org_id } = (await pool.query<{ org_id: string }>(`SELECT org_id FROM line_identities WHERE channel='farmer' AND line_user_id=$1`, [userId])).rows[0]!;
    const draftId = withDraft ? (await pool.query<{ id: string }>(`SELECT id FROM drafts WHERE org_id=$1`, [org_id])).rows[0]!.id : null;
    return { userId, orgId: org_id, draftId };
  }
  const mediaCount = (orgId: string) => count(`SELECT count(*) FROM media WHERE org_id = $1`, [orgId]);
  const jobCount = (orgId: string) =>
    count(`SELECT count(*) FROM jobs WHERE kind = 'assess_image' AND payload->>'media_id' IN (SELECT id::text FROM media WHERE org_id = $1)`, [orgId]);

  it('attaches the image to the active draft, queues one job, and replies with the disclaimer', async () => {
    const f = await farmerWithDraft();
    const msgId = `m-${Date.now()}-a`;
    line.setContent(msgId, { ok: true, bytes: makeImageBytes('jpeg', 11), contentType: 'image/jpeg' });
    const ev = await store(f.userId, imageEvt(msgId));
    await gateway.process(ev);
    const media = (await pool.query(`SELECT owner_type, owner_id FROM media WHERE org_id = $1`, [f.orgId])).rows;
    expect(media).toEqual([{ owner_type: 'DRAFT', owner_id: f.draftId }]);
    expect(await jobCount(f.orgId)).toBe(1);
    const text = await pushText(ev);
    expect(text).toContain(ASSESSMENT_DISCLAIMER_TH);
    expect(text).toContain('ได้รับรูปแล้ว');
    // The farmer channel (and only it) downloaded the content.
    expect(line.contentCalls.filter((c) => c.messageId === msgId)).toEqual([{ channel: 'farmer', token: 'fake-token-farmer', messageId: msgId }]);
  });

  it('a duplicate event or a re-sent image adds no media row and no job', async () => {
    const f = await farmerWithDraft();
    const a = `m-${Date.now()}-b1`;
    const b = `m-${Date.now()}-b2`;
    const bytes = makeImageBytes('png', 12);
    line.setContent(a, { ok: true, bytes, contentType: 'image/png' });
    line.setContent(b, { ok: true, bytes, contentType: 'image/png' });
    const ev = await store(f.userId, imageEvt(a));
    await gateway.process(ev);
    await gateway.process(ev);
    await gateway.process(await store(f.userId, imageEvt(b)));
    expect(await mediaCount(f.orgId)).toBe(1);
    expect(await jobCount(f.orgId)).toBe(1);
  });

  it('rejects an oversized or wrong-type image politely and stores nothing', async () => {
    const f = await farmerWithDraft();
    const big = `m-${Date.now()}-c1`;
    const gif = `m-${Date.now()}-c2`;
    const huge = `m-${Date.now()}-c3`;
    line.setContent(big, { ok: true, bytes: makeImageBytes('png', 13, 5 * 1024 * 1024 + 1), contentType: 'image/png' });
    line.setContent(gif, { ok: true, bytes: Buffer.from('GIF89a-not-allowed'), contentType: 'image/gif' });
    line.setContent(huge, { ok: false, code: 'TOO_LARGE' });
    const e1 = await store(f.userId, imageEvt(big));
    const e2 = await store(f.userId, imageEvt(gif));
    const e3 = await store(f.userId, imageEvt(huge));
    for (const e of [e1, e2, e3]) await gateway.process(e);
    expect(await pushText(e1)).toContain(FARMER_IMAGE_TEXT.tooLarge);
    expect(await pushText(e2)).toContain(FARMER_IMAGE_TEXT.wrongType);
    expect(await pushText(e3)).toContain(FARMER_IMAGE_TEXT.tooLarge);
    expect(await mediaCount(f.orgId)).toBe(0);
    expect(await jobCount(f.orgId)).toBe(0);
  });

  it('a download failure gets a polite message', async () => {
    const f = await farmerWithDraft();
    const id = `m-${Date.now()}-d`;
    line.setContent(id, { ok: false, code: 'TIMEOUT' });
    const ev = await store(f.userId, imageEvt(id));
    await gateway.process(ev);
    expect(await pushText(ev)).toContain(FARMER_IMAGE_TEXT.failed);
    expect(await mediaCount(f.orgId)).toBe(0);
  });

  it('with no active draft it asks to start a listing and downloads nothing', async () => {
    const f = await farmerWithDraft(false);
    const id = `m-${Date.now()}-e`;
    line.setContent(id, { ok: true, bytes: makeImageBytes('jpeg', 14), contentType: 'image/jpeg' });
    const ev = await store(f.userId, imageEvt(id));
    await gateway.process(ev);
    expect(await pushText(ev)).toContain(FARMER_IMAGE_TEXT.needDraft);
    expect(await mediaCount(f.orgId)).toBe(0);
    expect(line.contentCalls.some((c) => c.messageId === id)).toBe(false);
  });

  it('VISION_ENABLED=false stores UNAVAILABLE and the listing still publishes', async () => {
    const f = await farmerWithDraft();
    const id = `m-${Date.now()}-f`;
    line.setContent(id, { ok: true, bytes: makeImageBytes('jpeg', 15), contentType: 'image/jpeg' });
    await gateway.process(await store(f.userId, imageEvt(id)));
    const handlers = new HandlerRegistry();
    registerAssessImage(handlers, {
      assessment: createAssessmentService({ pool, queue: createJobQueue(pool), secret: 'test-secret', ttlSeconds: 60 }),
      assessor: createImageAssessor({ bedrock: new MockBedrock([]), modelId: 'anthropic.claude-sonnet-5', enabled: false }),
    });
    await new JobRunner({ queue: createJobQueue(pool), handlers, batchSize: 200 }).tick();
    const row = (await pool.query(
      `SELECT a.status FROM image_assessments a JOIN media m ON m.id = a.media_id WHERE m.org_id = $1`, [f.orgId])).rows;
    expect(row).toEqual([{ status: 'UNAVAILABLE' }]);
    // Fill the draft and publish through the confirm button: the assessment status does not block it.
    const drafts = createDraftService({ pool });
    const actor = { userId: (await pool.query(`SELECT user_id FROM line_identities WHERE line_user_id=$1`, [f.userId])).rows[0].user_id as string,
      orgId: f.orgId, role: 'FARMER' as const, channel: 'line:farmer' as const };
    const patched = await drafts.patch(actor, {
      draftId: f.draftId!,
      expectedVersion: (await pool.query(`SELECT version FROM drafts WHERE id=$1`, [f.draftId])).rows[0].version as number,
      patch: { quantity: { value: '5', unit: 'ton' }, price_mode: 'NEGOTIABLE', province: 'Uttaradit' },
    });
    if (!patched.ok) throw new Error(patched.error.code);
    const v = patched.value.draft.version;
    const confirm = await store(f.userId, { type: 'postback', replyToken: 'rt', postback: { data: `action=draft_confirm&id=${f.draftId}&v=${v}` } });
    await gateway.process(confirm);
    expect(await count(`SELECT count(*) FROM material_listings WHERE org_id = $1`, [f.orgId])).toBe(1);
  });
});
