// Task 10.5: assistant composition. Real services, MockBedrock only (no AWS call).
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockBedrock } from '../src/adapters/bedrock/test-support.js';
import { composeAssistant, type AssistantEnv } from '../src/assistant/index.js';
import { resolveAiMode } from '../src/config/env.js';
import { createConversationService, createDraftService, createMatchReadService } from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeOrgWithUser } from './factories.js';

const baseEnv: AssistantEnv = { ENABLE_REAL_BEDROCK: false, BEDROCK_MODEL_ID: 'anthropic.claude-sonnet-5', ASSISTANT_HISTORY_MESSAGES: 12 };

describe('resolveAiMode', () => {
  it('defaults from ENABLE_REAL_BEDROCK and lets AI_MODE override', () => {
    expect(resolveAiMode({ ENABLE_REAL_BEDROCK: false })).toBe('disabled');
    expect(resolveAiMode({ ENABLE_REAL_BEDROCK: true })).toBe('enabled');
    expect(resolveAiMode({ ENABLE_REAL_BEDROCK: true, AI_MODE: 'disabled' })).toBe('disabled');
    expect(resolveAiMode({ ENABLE_REAL_BEDROCK: false, AI_MODE: 'enabled' })).toBe('enabled');
  });
});

describe.skipIf(!testDatabaseUrl)('composeAssistant (real services, MockBedrock)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
  });
  afterAll(async () => {
    await db?.close();
  });
  const build = (env: AssistantEnv, bedrock: MockBedrock) =>
    composeAssistant({
      env, bedrock,
      drafts: createDraftService({ pool }),
      conversations: createConversationService({ pool }),
      matches: createMatchReadService({ pool }),
    });
  async function farmer() {
    const { org, user } = await makeOrgWithUser(pool, 'FARMER');
    return { userId: user.id, orgId: org.id, role: 'FARMER' as const, channel: 'line:farmer' as const };
  }

  it('AI_MODE=disabled never calls the model and answers in step-form mode', async () => {
    const bedrock = new MockBedrock([]);
    const r = await build({ ...baseEnv, AI_MODE: 'disabled' }, bedrock).handle(await farmer(), { text: 'อยากขายฟาง' });
    expect(r.ok && r.value?.degraded).toBe(true);
    // "อยากขายฟาง" now starts the sale form (it used to show the menu again, so the old expectation was noWrite: true).
    expect(r.ok && r.value?.draft?.kind).toBe('SALE_LISTING');
    expect(bedrock.calls.length).toBe(0);
  });

  it('AI_MODE=enabled calls the supplied adapter', async () => {
    const bedrock = new MockBedrock([{ type: 'json', value: { intent: 'GENERAL', reply_text: 'สวัสดีครับ' } }]);
    const r = await build({ ...baseEnv, AI_MODE: 'enabled' }, bedrock).handle(await farmer(), { text: 'สวัสดี' });
    expect(r.ok && r.value?.degraded).not.toBe(true);
    expect(bedrock.calls.length).toBe(1);
  });

  it('defaults to step-form mode when real Bedrock is off', async () => {
    const bedrock = new MockBedrock([]);
    const r = await build(baseEnv, bedrock).handle(await farmer(), { text: 'อยากขายฟาง' });
    expect(r.ok && r.value?.degraded).toBe(true);
    expect(bedrock.calls.length).toBe(0);
  });
});
