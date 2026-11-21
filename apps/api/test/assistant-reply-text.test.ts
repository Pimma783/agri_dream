// Replies reach farmers in Thai only, without internal codes, repeats or more than two questions.
// MockBedrock only: no AWS call, no database (conversation and draft services are in-memory stubs).
import { describe, expect, it } from 'vitest';
import { MockBedrock } from '../src/adapters/bedrock/test-support.js';
import { createAssistant } from '../src/assistant/index.js';
import { ASSISTANT_SYSTEM } from '../src/assistant/prompts.js';
import { replaceCodes, tidyQuestions, tidyReplyText } from '../src/assistant/reply-text.js';
import { ok } from '../src/services/index.js';
import type { Actor } from '../src/domain/permissions.js';
import type { ConversationService, DraftService } from '../src/services/index.js';
const CODES = /FIXED|NEGOTIABLE|RICE_STRAW|CANE_LEAF|CORN_COB|\bKG\b|\bTON\b|[a-z]+_[a-z_]+/;
describe('replaceCodes', () => {
  it('turns enum words into Thai and drops a parenthetical code that repeats its Thai word', () => {
    const out = replaceCodes('ราคาตายตัว (FIXED) หรือต่อรองได้ (NEGOTIABLE)?');
    expect(out).toBe('ราคาตายตัว หรือต่อรองได้?');
    expect(replaceCodes('ฟางชนิด RICE_STRAW ปริมาณ 5 TON หรือ 5000 KG')).toBe('ฟางชนิด ฟางข้าว ปริมาณ 5 ตัน หรือ 5000 กก.');
    expect(replaceCodes('ราคา FIXED หรือ NEGOTIABLE')).toBe('ราคา ตายตัว หรือ ต่อรองได้');
  });
  it('replaces field keys and unknown snake_case keys with Thai, never the raw key', () => {
    expect(replaceCodes('ขอ qty_kg และ price_mode')).toBe('ขอ ปริมาณ และ รูปแบบราคา');
    expect(replaceCodes('ขอ some_unknown_key')).not.toMatch(/some_unknown_key/);
  });
});
describe('tidyReplyText', () => {
  it('removes repeated lines and sentences, ignoring numbering, and caps questions at two', () => {
    const raw = ['ขอข้อมูลเพิ่มค่ะ', 'ขอข้อมูลเพิ่มค่ะ', '1. ปริมาณเท่าไรคะ?', '2) ปริมาณเท่าไรคะ?', 'จังหวัดอะไรคะ? จังหวัดอะไรคะ?', 'ราคาเท่าไรคะ?'].join('\n');
    const out = tidyReplyText(raw);
    expect(out.split('\n')).toEqual(['ขอข้อมูลเพิ่มค่ะ', '1. ปริมาณเท่าไรคะ?', 'จังหวัดอะไรคะ?']);
  });
  it('keeps at most two distinct questions', () => {
    const out = tidyReplyText('รับทราบ\nปริมาณเท่าไรคะ?\nจังหวัดอะไรคะ?\nราคาเท่าไรคะ?\nวันไหนพร้อมคะ?');
    expect(out.split('\n').filter((l) => l.includes('?'))).toHaveLength(2);
    expect(out).toContain('รับทราบ');
  });
  it('tidyQuestions de-duplicates and caps', () => {
    expect(tidyQuestions(['a1?', 'a1?', 'b2?', 'c3?'])).toEqual(['a1?', 'b2?']);
    expect(tidyQuestions(undefined)).toBeUndefined();
  });
});
describe('system prompt', () => {
  it('asks for Thai only, no codes, at most two items, no repetition, short replies', () => {
    expect(ASSISTANT_SYSTEM).toMatch(/Thai only/);
    expect(ASSISTANT_SYSTEM).toMatch(/at most two missing items/);
    expect(ASSISTANT_SYSTEM).toMatch(/never repeat/);
    expect(ASSISTANT_SYSTEM).toMatch(/2-4 lines/);
  });
});
describe('assistant reply with a misbehaving model', () => {
  const farmer: Actor = { userId: 'u1', orgId: 'o1', role: 'FARMER', channel: 'line:farmer' };
  const conv = { id: 'c1', active_draft_id: null };
  const conversations = {
    open: async () => ok(conv),
    append: async () => ok({ id: 'm1' }),
    recent: async () => ok([{ direction: 'IN', text: 'ขายฟาง' }]),
    setActiveDraft: async () => ok(undefined),
  } as unknown as ConversationService;
  const drafts = {} as unknown as DraftService;
  async function replyFor(reply_text: string, questions?: string[]) {
    const bedrock = new MockBedrock([{ type: 'json', value: { intent: 'CLARIFY', reply_text, ...(questions ? { questions } : {}) } }]);
    const a = createAssistant({ bedrock, modelId: 'anthropic.claude-sonnet-5', drafts, conversations });
    const r = await a.handle(farmer, { text: 'ขายฟาง' });
    if (!r.ok || r.value === null) throw new Error('no reply');
    return r.value;
  }
  it('renders FIXED/NEGOTIABLE and duplicated questions in Thai without codes or duplicates', async () => {
    const q = 'ราคาตายตัว (FIXED) หรือต่อรองได้ (NEGOTIABLE)?';
    const r = await replyFor(`ขอข้อมูลเพิ่มนะคะ\n${q}\n${q}`, [q, 'ปริมาณกี่ KG หรือ TON คะ?', 'จังหวัดอะไรคะ?', 'ชนิด RICE_STRAW ใช่ไหมคะ?']);
    expect(r.tool).toBe('ask_user');
    expect(r.text).not.toMatch(CODES);
    expect(r.text.split(q.replace(' (FIXED)', '').replace(' (NEGOTIABLE)', '')).length - 1).toBe(1);
    const lines = r.text.split('\n');
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines.filter((l) => /[?？]\s*$/.test(l))).toHaveLength(2);
    expect(r.text).toContain('ราคาตายตัว หรือต่อรองได้?');
    expect(r.noWrite).toBe(true);
  });
  it('also cleans a general answer', async () => {
    const bedrock = new MockBedrock([{ type: 'json', value: { intent: 'GENERAL', reply_text: 'ฟาง RICE_STRAW ขายได้ 5 TON\nฟาง RICE_STRAW ขายได้ 5 TON' } }]);
    const a = createAssistant({ bedrock, modelId: 'anthropic.claude-sonnet-5', drafts, conversations });
    const r = await a.handle(farmer, { text: 'ถาม' });
    if (!r.ok || r.value === null) throw new Error('no reply');
    expect(r.value.text).toBe('ฟาง ฟางข้าว ขายได้ 5 ตัน');
  });
});
