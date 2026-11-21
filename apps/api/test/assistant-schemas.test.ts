import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AssistantTurnSchema,
  DRAFT_KINDS,
  ImageAssessmentSchema,
  PATCH_WHITELIST,
  parseModelJson,
} from '../src/assistant/schemas.js';

const turn = (draft_patch?: unknown) => ({ intent: 'SELL_MATERIAL', reply_text: 'ok', draft_patch });
const sale = (fields: unknown) => turn({ kind: 'SALE_LISTING', fields });

describe('AssistantTurnSchema', () => {
  it('accepts a valid sale patch and normalizes numbers to strings', () => {
    const r = AssistantTurnSchema.parse(
      sale({ material_type: 'RICE_STRAW', quantity: { value: 5, unit: 'ton' }, price: { value: 1.5, unit: 'kg' } }),
    );
    expect(r.draft_patch?.fields).toMatchObject({ quantity: { value: '5', unit: 'ton' }, price: { value: '1.5' } });
  });

  it('accepts a turn without a patch', () => {
    expect(AssistantTurnSchema.safeParse({ intent: 'GENERAL', reply_text: 'hi' }).success).toBe(true);
  });

  it.each(['เกวียน', 'ไร่', 'bale', 'KG', 'tons'])('rejects quantity unit %s', (unit) => {
    expect(AssistantTurnSchema.safeParse(sale({ quantity: { value: 3, unit } })).success).toBe(false);
  });

  it.each([0, -1, Number.NaN, Infinity])('rejects non-positive or non-finite quantity %s', (value) => {
    expect(AssistantTurnSchema.safeParse(sale({ quantity: { value, unit: 'kg' } })).success).toBe(false);
  });

  it.each(['status', 'version', 'org_id', 'published_entity_id', 'source_agreement_id', 'is_demo'])(
    'rejects forbidden field %s in a patch',
    (key) => {
      expect(AssistantTurnSchema.safeParse(sale({ [key]: 'x' })).success).toBe(false);
    },
  );

  it('rejects unknown top-level keys such as publish instructions', () => {
    expect(AssistantTurnSchema.safeParse({ ...turn(), action: 'publish' }).success).toBe(false);
    expect(AssistantTurnSchema.safeParse({ ...turn(), publish: true }).success).toBe(false);
  });

  it('rejects a field that belongs to another draft kind', () => {
    expect(
      AssistantTurnSchema.safeParse(turn({ kind: 'BALING_REQUEST', fields: { target_quantity: { value: 1, unit: 'kg' } } }))
        .success,
    ).toBe(false);
    expect(
      AssistantTurnSchema.safeParse(turn({ kind: 'SALE_LISTING', fields: { expected_ready_at: '2026-12-01' } })).success,
    ).toBe(false);
  });

  it('allows resale-only fields on RESALE_LISTING', () => {
    const r = AssistantTurnSchema.safeParse(
      turn({ kind: 'RESALE_LISTING', fields: { pending_material: true, expected_ready_at: '2026-12-01' } }),
    );
    expect(r.success).toBe(true);
  });

  it('rejects non-ISO dates, bad enums and over-long reply text', () => {
    expect(AssistantTurnSchema.safeParse(sale({ available_from: 'next week' })).success).toBe(false);
    expect(AssistantTurnSchema.safeParse(sale({ material_type: 'WOOD' })).success).toBe(false);
    expect(AssistantTurnSchema.safeParse({ intent: 'GENERAL', reply_text: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('caps demand radius at the 80 km limit', () => {
    const d = (radius_km: number) => turn({ kind: 'PURCHASE_DEMAND', fields: { radius_km } });
    expect(AssistantTurnSchema.safeParse(d(80)).success).toBe(true);
    expect(AssistantTurnSchema.safeParse(d(81)).success).toBe(false);
  });

  it('has a whitelist per draft kind with no system-owned field', () => {
    const banned = ['status', 'version', 'org_id', 'source_agreement_id', 'id', 'created_by'];
    for (const kind of DRAFT_KINDS) {
      const names = PATCH_WHITELIST[kind];
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((n) => banned.includes(n) || n.startsWith('published'))).toEqual([]);
    }
  });

  // Feature: agrimatch-mvp, Property 19: Assistant output validation and authority (schema part)
  it('property: any accepted turn has only whitelisted fields and kg/ton units', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const r = AssistantTurnSchema.safeParse(value);
        if (!r.success) return true;
        const patch = r.data.draft_patch;
        if (!patch) return true;
        const allowed = PATCH_WHITELIST[patch.kind];
        const fields = patch.fields as Record<string, unknown>;
        expect(Object.keys(fields).every((k) => allowed.includes(k))).toBe(true);
        for (const v of Object.values(fields)) {
          if (v && typeof v === 'object' && 'unit' in v) expect(['kg', 'ton']).toContain((v as { unit: string }).unit);
        }
        return true;
      }),
    );
  });

  it('property: an extra key on a patch is always rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DRAFT_KINDS),
        fc.string({ minLength: 1 }).filter((k) => !Object.values(PATCH_WHITELIST).flat().includes(k) && k !== '__proto__'),
        (kind, key) => {
          const r = AssistantTurnSchema.safeParse(turn({ kind, fields: { [key]: 1 } }));
          expect(r.success).toBe(false);
        },
      ),
    );
  });
});

describe('ImageAssessmentSchema', () => {
  const ok = {
    likely_material: 'RICE_STRAW',
    color: 'เหลืองทอง',
    surface_condition: 'แห้ง',
    visible_contaminants: [],
    limitations: ['ดูจากภาพเดียว'],
    follow_up_questions: [],
  };

  it('accepts a valid result', () => {
    expect(ImageAssessmentSchema.safeParse(ok).success).toBe(true);
  });

  it.each(['moisture_percent', 'moisture', 'heating_value', 'grade', 'standard', 'standard_compliance', 'kcal'])(
    'rejects the forbidden field %s',
    (key) => {
      expect(ImageAssessmentSchema.safeParse({ ...ok, [key]: 'x' }).success).toBe(false);
    },
  );

  it('defines none of the forbidden fields', () => {
    const keys = Object.keys(ImageAssessmentSchema.shape);
    expect(keys.filter((k) => /moisture|grade|standard|heating|kcal/i.test(k))).toEqual([]);
  });
});

describe('parseModelJson', () => {
  it('parses plain and fenced JSON and returns null otherwise', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('not json')).toBeNull();
  });
});
