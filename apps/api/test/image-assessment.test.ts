// Unit tests for image-assessment rules (Requirement 8): post-validator and the assessor on a scripted mock.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DisabledBedrock } from '../src/adapters/bedrock/index.js';
import { INJECTION_TEXT, MockBedrock } from '../src/adapters/bedrock/test-support.js';
import { createImageAssessor, IMAGE_ASSESSOR_SYSTEM } from '../src/assistant/image-assessor.js';
import { ASSESSMENT_DISCLAIMER_TH, hasForbiddenClaim, stripForbiddenClaims } from '../src/domain/assessment.js';
import { makeImageBytes } from './factories.js';
const good = {
  likely_material: 'RICE_STRAW',
  color: 'เหลืองทอง',
  surface_condition: 'แห้งดูสม่ำเสมอ',
  visible_contaminants: ['ดิน'],
  limitations: ['ภาพถ่ายระยะไกล'],
  follow_up_questions: ['เก็บฟางไว้ในที่มีหลังคาหรือไม่'],
};
const input = { bytes: makeImageBytes('jpeg', 1), contentType: 'image/jpeg' as const };
describe('post-validator', () => {
  it('uses the fixed Thai disclaimer', () => {
    expect(ASSESSMENT_DISCLAIMER_TH).toBe('การประเมินเบื้องต้นจากภาพ ไม่ใช่ผลตรวจคุณภาพจริง');
  });
  it.each(['ความชื้น 12%', 'เกรด A', 'ผ่านมาตรฐานโรงงาน', '4000 kcal/kg', '15 MJ', 'moisture 12 percent', 'Grade A', 'ISO certified'])(
    'flags %s',
    (t) => expect(hasForbiddenClaim(t)).toBe(true),
  );
  it.each(['เหลืองทอง', 'แห้งดู', 'มีดินปน'])('keeps %s', (t) => expect(hasForbiddenClaim(t)).toBe(false));
  it('drops array items, blanks fields and drops keys that claim a value', () => {
    const { value, removed } = stripForbiddenClaims({ color: 'ชื้น 20%', visible_contaminants: ['ดิน', 'เกรด B'], moisture_percent: 'x', ok: 'fine' });
    expect(value).toEqual({ color: '', visible_contaminants: ['ดิน'], ok: 'fine' });
    expect(removed).toBe(3);
  });
  it('property: stripped output never contains a forbidden claim', () => {
    const word = fc.oneof(fc.string({ maxLength: 20 }), fc.constantFrom('12%', 'เกรด A', 'มาตรฐาน', 'kcal', 'MJ', 'grade', 'standard'));
    fc.assert(
      fc.property(fc.record({ color: word, items: fc.array(word, { maxLength: 6 }) }), (v) => {
        const { value } = stripForbiddenClaims(v);
        expect(hasForbiddenClaim(JSON.stringify(value))).toBe(false);
      }),
    );
  });
});
describe('createImageAssessor', () => {
  const make = (bedrock: MockBedrock | DisabledBedrock, enabled = true) =>
    createImageAssessor({ bedrock, modelId: 'test-vision-model', enabled });
  it('returns OK with model id for a valid result and keeps the image out of the system prompt', async () => {
    const bedrock = new MockBedrock([{ type: 'json', value: good }]);
    const out = await make(bedrock).assess(input);
    expect(out).toEqual({ kind: 'OK', result: good, modelId: 'test-vision-model' });
    const call = bedrock.calls[0]!;
    expect(call.system).toBe(IMAGE_ASSESSOR_SYSTEM);
    expect(call.messages[0]!.content.some((c) => c.type === 'image')).toBe(true);
  });
  it('VISION_ENABLED=false is UNAVAILABLE and never calls the model', async () => {
    const bedrock = new MockBedrock([{ type: 'json', value: good }]);
    expect(await make(bedrock, false).assess(input)).toEqual({ kind: 'UNAVAILABLE', errorCode: 'VISION_DISABLED' });
    expect(bedrock.calls).toHaveLength(0);
  });
  it('a disabled adapter is UNAVAILABLE', async () => {
    expect(await make(new DisabledBedrock()).assess(input)).toEqual({ kind: 'UNAVAILABLE', errorCode: 'DISABLED' });
  });
  it.each([
    ['unsupported_image', 'MODEL_UNSUPPORTED'],
    ['error', 'ACCESS_DENIED'],
  ] as const)('maps %s to UNAVAILABLE', async (type, code) => {
    const step = type === 'error' ? ({ type, code, retryable: false } as const) : ({ type } as const);
    expect(await make(new MockBedrock([step])).assess(input)).toEqual({ kind: 'UNAVAILABLE', errorCode: code });
  });
  it.each(['timeout', 'throttled'] as const)('maps %s to RETRYABLE', async (type) => {
    expect((await make(new MockBedrock([{ type }])).assess(input)).kind).toBe('RETRYABLE');
  });
  it('treats instructions found in the image as data: not parseable means UNASSESSABLE', async () => {
    const out = await make(new MockBedrock([{ type: 'injection' }])).assess(input);
    expect(out).toMatchObject({ kind: 'UNASSESSABLE', errorCode: 'BAD_OUTPUT' });
    expect(JSON.stringify(out)).not.toContain(INJECTION_TEXT);
  });
  it('injection text inside an allowed field is carried as plain text and grants nothing', async () => {
    const bedrock = new MockBedrock([{ type: 'json', value: { ...good, surface_condition: INJECTION_TEXT.slice(0, 190) } }]);
    const out = await make(bedrock).assess(input);
    expect(out.kind).toBe('OK');
    expect(Object.keys((out as { result: object }).result).sort()).toEqual(Object.keys(good).sort());
  });
  it.each([
    ['moisture field', { ...good, moisture_percent: 12 }],
    ['grade field', { ...good, grade: 'A' }],
    ['status field', { ...good, status: 'OK', org_id: 'x' }],
  ])('rejects extra keys: %s', async (_n, value) => {
    expect((await make(new MockBedrock([{ type: 'json', value }])).assess(input)).kind).toBe('UNASSESSABLE');
  });
  it('rejects malformed JSON', async () => {
    expect((await make(new MockBedrock([{ type: 'malformed_json' }])).assess(input)).kind).toBe('UNASSESSABLE');
  });
});
