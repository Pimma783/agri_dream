// Demo default weights from docs/AGRIMATCH_MVP_SPEC.md section 10.3. These are test assumptions,
// not a proven formula. Changing a weight means a new file and a new version string.
import { z } from 'zod';
import type { RuleConfig } from '../types.js';

const WEIGHT = /^(0|1)(\.\d{1,4})?$/;

/** Weight as a decimal string with at most 4 dp, in [0, 1]. */
const weightSchema = z.string().regex(WEIGHT).refine((s) => Number(s) <= 1, 'weight must be <= 1');

/** Sum in integer 1/10000 units, so the check is exact. */
const toUnits = (s: string): number => {
  const [i = '0', f = ''] = s.split('.');
  return Number(i) * 10000 + Number(f.padEnd(4, '0'));
};

const group = <K extends string>(keys: readonly K[]) =>
  z
    .object(Object.fromEntries(keys.map((k) => [k, weightSchema])) as Record<K, typeof weightSchema>)
    .strict()
    .refine((w) => (Object.values(w) as string[]).reduce((a, s) => a + toUnits(s), 0) === 10000, {
      message: 'weights must sum to 1',
    });

export const ruleConfigSchema = z
  .object({
    version: z.string().min(1),
    maxTransportKm: z.number().finite().positive(),
    trade: group(['distance', 'quantity', 'price', 'time', 'conditions'] as const),
    service: group(['serviceArea', 'materialForm', 'time', 'quantity', 'price'] as const),
  })
  .strict();

/** Throws a ZodError when the config is invalid. Returns a deeply frozen copy. */
export function validateRuleConfig(input: unknown): RuleConfig {
  const parsed = ruleConfigSchema.parse(input);
  return Object.freeze({
    ...parsed,
    trade: Object.freeze({ ...parsed.trade }),
    service: Object.freeze({ ...parsed.service }),
  });
}

export const RULES_V1: RuleConfig = validateRuleConfig({
  version: 'rules-2026-11-18.1',
  maxTransportKm: 80,
  trade: { distance: '0.30', quantity: '0.25', price: '0.20', time: '0.15', conditions: '0.10' },
  service: { serviceArea: '0.35', materialForm: '0.25', time: '0.20', quantity: '0.10', price: '0.10' },
});
