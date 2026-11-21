import { describe, expect, it } from 'vitest';
import { RULES_V1, validateRuleConfig } from '../src/matching/rules/v1.js';
import { EXCLUSION_CODES } from '../src/matching/types.js';

const base = {
  version: 'v-test',
  maxTransportKm: 80,
  trade: { distance: '0.30', quantity: '0.25', price: '0.20', time: '0.15', conditions: '0.10' },
  service: { serviceArea: '0.35', materialForm: '0.25', time: '0.20', quantity: '0.10', price: '0.10' },
};

describe('matching rule config v1', () => {
  it('uses the spec 10.3 weights and the 80 km cap', () => {
    expect(RULES_V1.maxTransportKm).toBe(80);
    expect(RULES_V1.version).toMatch(/^rules-/);
    expect(RULES_V1.trade).toEqual(base.trade);
    expect(RULES_V1.service).toEqual(base.service);
    expect(Object.isFrozen(RULES_V1)).toBe(true);
    expect(Object.isFrozen(RULES_V1.trade)).toBe(true);
  });

  it('rejects weights that do not sum to 1', () => {
    expect(() => validateRuleConfig({ ...base, trade: { ...base.trade, price: '0.25' } })).toThrow();
    expect(() => validateRuleConfig({ ...base, service: { ...base.service, time: '0.10' } })).toThrow();
  });

  it('rejects negative weights, bad cap and empty version', () => {
    expect(() => validateRuleConfig({ ...base, trade: { ...base.trade, price: '-0.1', distance: '0.60' } })).toThrow();
    expect(() => validateRuleConfig({ ...base, maxTransportKm: 0 })).toThrow();
    expect(() => validateRuleConfig({ ...base, version: '' })).toThrow();
  });

  it('accepts a different valid split', () => {
    const cfg = validateRuleConfig({ ...base, trade: { distance: '0.5', quantity: '0.5', price: '0', time: '0', conditions: '0' } });
    expect(cfg.trade.distance).toBe('0.5');
  });

  it('lists exclusion codes in the fixed order', () => {
    expect(EXCLUSION_CODES).toEqual([
      'NOT_PUBLISHED', 'NO_REMAINING', 'SAME_ORG', 'MATERIAL_MISMATCH', 'FORM_MISMATCH',
      'BELOW_MIN_LOT', 'WINDOW_NO_OVERLAP', 'AREA_MISMATCH', 'OVER_RADIUS', 'OVER_MAX_TRANSPORT',
    ]);
  });
});
