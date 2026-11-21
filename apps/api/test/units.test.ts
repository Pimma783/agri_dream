import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  D, kg, kgFromDb, kgToDb, money, moneyFromDb, moneyToDb, normalizePriceToThbPerKg,
  roundHalfUp, toKg, TOTAL_SCALE,
} from '../src/domain/units.js';

// ≤3 fractional digits, non-negative, expressed as a decimal string.
const dec3 = fc
  .tuple(fc.integer({ min: 0, max: 99_999_999 }), fc.integer({ min: 0, max: 999 }))
  .map(([i, f]) => `${i}.${String(f).padStart(3, '0')}`);
const dec4 = fc
  .tuple(fc.integer({ min: 0, max: 99_999_999 }), fc.integer({ min: 0, max: 9999 }))
  .map(([i, f]) => `${i}.${String(f).padStart(4, '0')}`);

describe('units and decimals', () => {
  // Feature: agrimatch-mvp, Property 1: Unit and decimal round trip
  // **Validates: Requirements 6.2, 6.3, 6.9**
  it('ton multiplies by exactly 1000 and kg is unchanged', () => {
    fc.assert(
      fc.property(dec3, (x) => {
        const t = toKg({ value: x, unit: 'ton' });
        const k = toKg({ value: x, unit: 'kg' });
        expect(t.ok && k.ok).toBe(true);
        if (t.ok && k.ok) {
          expect(t.kg.equals(new D(x).times(1000))).toBe(true);
          expect(k.kg.equals(new D(x))).toBe(true);
        }
      }),
    );
  });

  it('fromDb(toDb(v)) equals v for Kg and Money, and string JSON round-trips', () => {
    fc.assert(
      fc.property(dec3, dec4, (a, b) => {
        const k = kg(a);
        const m = money(b);
        expect(kgFromDb(kgToDb(k)).equals(k)).toBe(true);
        expect(moneyFromDb(moneyToDb(m)).equals(m)).toBe(true);
        expect(kg(JSON.parse(JSON.stringify(kgToDb(k)))).equals(k)).toBe(true);
        expect(money(JSON.parse(JSON.stringify(moneyToDb(m)))).equals(m)).toBe(true);
      }),
    );
  });

  it('local or unknown units return needs-confirmation and no number', () => {
    fc.assert(
      fc.property(
        dec3,
        fc.string().filter((u) => u !== 'kg' && u !== 'ton'),
        (x, unit) => {
          expect(toKg({ value: x, unit })).toEqual({ ok: false, code: 'NEEDS_CONFIRMATION' });
        },
      ),
    );
    for (const unit of ['เกวียน', 'ไร่', 'bales']) {
      expect(toKg({ value: '2', unit })).toEqual({ ok: false, code: 'NEEDS_CONFIRMATION' });
    }
  });

  it('rejects negative and non-decimal values', () => {
    expect(toKg({ value: '-1', unit: 'kg' })).toEqual({ ok: false, code: 'INVALID_VALUE' });
    expect(toKg({ value: 'abc', unit: 'ton' })).toEqual({ ok: false, code: 'INVALID_VALUE' });
    expect(toKg({ value: '1e3', unit: 'kg' })).toEqual({ ok: false, code: 'INVALID_VALUE' });
  });

  it('avoids floating-point error', () => {
    const r = toKg({ value: '0.1', unit: 'ton' });
    expect(r.ok && kgToDb(r.kg)).toBe('100.000');
    expect(new D('0.1').plus('0.2').toString()).toBe('0.3');
  });

  it('rounds half up, including at the total scale', () => {
    expect(kgToDb(kg('1.0005'))).toBe('1.001');
    expect(roundHalfUp(new D('2.345'), TOTAL_SCALE).toString()).toBe('2.35');
    expect(roundHalfUp(new D('-2.345'), TOTAL_SCALE).toString()).toBe('-2.35');
    expect(moneyToDb(money('10.5'), TOTAL_SCALE)).toBe('10.50');
  });

  it('normalizes price to THB per kg; bale and unknown units give null', () => {
    expect(normalizePriceToThbPerKg(money('2.5'), 'THB_PER_KG')?.toString()).toBe('2.5');
    expect(normalizePriceToThbPerKg(money('2500'), 'THB_PER_TON')?.toString()).toBe('2.5');
    expect(normalizePriceToThbPerKg(money('80'), 'THB_PER_BALE')).toBeNull();
    expect(normalizePriceToThbPerKg(money('80'), 'THB_PER_เกวียน')).toBeNull();
  });
});
