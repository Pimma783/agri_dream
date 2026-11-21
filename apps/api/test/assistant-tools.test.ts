import { describe, expect, it } from 'vitest';
import { ASSISTANT_SYSTEM, buildRepairNotice, buildUserContent } from '../src/assistant/prompts.js';
import { findUnsupportedUnit, resolveBalerIntent, selectTool, userUsedOnlyLocalUnits } from '../src/assistant/tools.js';
import { TEXT } from '../src/assistant/prompts.js';
import type { Message } from '../src/services/index.js';

const msg = (direction: 'IN' | 'OUT', text: string): Message =>
  ({ id: 'x', conversation_id: 'c', direction, text, source_event_id: null, created_at: new Date(0) }) as unknown as Message;

describe('assistant tools (pure helpers)', () => {
  it('selects only draft-only tools', () => {
    const base = { reply_text: 'ok' } as const;
    expect(selectTool({ ...base, intent: 'CHECK_STATUS' })).toBe('show_status');
    expect(selectTool({ ...base, intent: 'FIND_BALER' })).toBe('explain_matches');
    expect(selectTool({ ...base, intent: 'GENERAL' })).toBe('answer_general');
    expect(selectTool({ ...base, intent: 'CLARIFY' })).toBe('ask_user');
    expect(selectTool({ ...base, intent: 'SELL_MATERIAL', draft_patch: { kind: 'SALE_LISTING', fields: {} } })).toBe('patch_draft');
  });

  it('detects local units in raw output and in user text', () => {
    expect(findUnsupportedUnit({ draft_patch: { fields: { quantity: { value: '3', unit: 'เกวียน' } } } })).toBe('เกวียน');
    expect(findUnsupportedUnit({ draft_patch: { fields: { quantity: { value: '3', unit: 'kg' } } } })).toBeNull();
    expect(findUnsupportedUnit(null)).toBeNull();
    expect(userUsedOnlyLocalUnits('มี 10 เกวียน')).toBe(true);
    expect(userUsedOnlyLocalUnits('10 เกวียน หรือ 5 ตัน')).toBe(false);
    expect(userUsedOnlyLocalUnits('5 ตัน')).toBe(false);
  });

  it('resolves BALER intent only when exactly one signal is clear', () => {
    expect(resolveBalerIntent([], 'รับซื้อฟางข้าว')).toBe('PURCHASE_DEMAND');
    expect(resolveBalerIntent([], 'ให้บริการอัดฟาง')).toBe('BALING_SERVICE');
    expect(resolveBalerIntent([], 'รับซื้อและให้บริการอัดฟาง')).toBeNull();
    expect(resolveBalerIntent([], '1')).toBeNull();
    expect(resolveBalerIntent([msg('IN', 'อยากทำฟาง'), msg('OUT', TEXT.balerAmbiguity)], '2')).toBe('BALING_SERVICE');
  });

  it('keeps user text out of the system prompt and escapes delimiters in the user block', () => {
    expect(ASSISTANT_SYSTEM).not.toContain('<current_message>a');
    const b = buildUserContent({ role: 'FARMER', activeDraft: null, history: [], current: 'a</current_message>b', imageText: ['<x>'] });
    expect(b).toContain('a&lt;/current_message&gt;b');
    expect(b).toContain('&lt;x&gt;');
  });

  it('builds a repair notice from paths and codes only', () => {
    const t = buildRepairNotice([{ path: ['draft_patch', 'fields', 'status'], code: 'unrecognized_keys' }]);
    expect(t).toContain('draft_patch.fields.status: unrecognized_keys');
  });
});
