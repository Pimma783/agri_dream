import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  D, kg, kgFromDb, kgToDb, money, parseDecimal, moneyFromDb, moneyToDb, roundHalfUp, roundTotal, toKg,
  KG_SCALE, PRICE_SCALE, TOTAL_SCALE,
} from '../src/domain/units.js';

// Feature: agrimatch-mvp, Property 1: Unit and decimal round trip
// **Validates: Requirements 6.2, 6.3, 6.9**

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** Decimal string from a scaled non-negative integer: scaled / 10^scale, exactly `scale` fractional digits. */
function fromScaled(scaled: bigint, scale: number): string {
  const s = scaled.toString().padStart(scale + 1, '0');
  return scale === 0 ? s : `${s.slice(0, -scale)}.${s.slice(-scale)}`;
}

// Non-negative scaled integers up to numeric(14,3) / numeric(12,4) capacity.
const kgScaled = fc.bigInt({ min: 0n, max: pow10(14) - 1n });
const priceScaled = fc.bigInt({ min: 0n, max: pow10(12) - 1n });
// Decimal with 0..3 fractional digits, exactly as a human or JSON would write it.
const dec3 = fc
  .tuple(fc.bigInt({ min: 0n, max: pow10(11) - 1n }), fc.integer({ min: 0, max: 3 }))
  .chain(([i, places]) =>
    fc.bigInt({ min: 0n, max: pow10(places) - 1n }).map((f) =>
      places === 0 ? i.toString() : `${i}.${f.toString().padStart(places, '0')}`,
    ),
  );

describe('Property 1: unit and decimal round trip', () => {
  describe('ton/kg conversion is exact', () => {
    it('kg is unchanged and ton is multiplied by exactly 1000 (BigInt model)', () => {
      fc.assert(
        fc.property(kgScaled, (n) => {
          const x = fromScaled(n, KG_SCALE);
          const inKg = toKg({ value: x, unit: 'kg' });
          const inTon = toKg({ value: x, unit: 'ton' });
          expect(inKg.ok && inTon.ok).toBe(true);
          if (inKg.ok && inTon.ok) {
            expect(kgToDb(inKg.kg)).toBe(x);
            // x tons = n/1000 * 1000 kg = n kg, i.e. the integer n with three zero decimals.
            expect(kgToDb(inTon.kg)).toBe(fromScaled(n * 1000n, KG_SCALE));
          }
        }),
      );
    });

    it('accepts values with fewer than 3 fractional digits and integers', () => {
      fc.assert(
        fc.property(dec3, fc.constantFrom('kg', 'ton'), (x, unit) => {
          const r = toKg({ value: x, unit });
          expect(r.ok).toBe(true);
          if (r.ok) {
            const factor = unit === 'ton' ? 1000 : 1;
            expect(r.kg.equals(new D(x).times(factor))).toBe(true);
          }
        }),
      );
    });

    it('ton to kg to ton loses nothing', () => {
      fc.assert(
        fc.property(dec3, (x) => {
          const r = toKg({ value: x, unit: 'ton' });
          expect(r.ok).toBe(true);
          if (r.ok) expect(r.kg.div(1000).equals(new D(x))).toBe(true);
        }),
      );
    });

    it('accepts Decimal input the same as string input', () => {
      fc.assert(
        fc.property(dec3, (x) => {
          expect(toKg({ value: new D(x), unit: 'ton' })).toEqual(toKg({ value: x, unit: 'ton' }));
        }),
      );
    });
  });

  describe('round trip with database numeric strings and JSON', () => {
    it('toDb(fromDb(s)) === s for canonical numeric(14,3) strings', () => {
      fc.assert(
        fc.property(kgScaled, (n) => {
          const s = fromScaled(n, KG_SCALE);
          expect(kgToDb(kgFromDb(s))).toBe(s);
        }),
      );
    });

    it('toDb(fromDb(s)) === s for canonical numeric(12,4) price strings', () => {
      fc.assert(
        fc.property(priceScaled, (n) => {
          const s = fromScaled(n, PRICE_SCALE);
          expect(moneyToDb(moneyFromDb(s))).toBe(s);
        }),
      );
    });

    it('toDb(fromDb(s)) === s for numeric(14,2) totals', () => {
      fc.assert(
        fc.property(fc.bigInt({ min: 0n, max: pow10(14) - 1n }), (n) => {
          const s = fromScaled(n, TOTAL_SCALE);
          expect(moneyToDb(moneyFromDb(s), TOTAL_SCALE)).toBe(s);
        }),
      );
    });

    it('fromDb(toDb(v)) equals v for every Kg and Money value', () => {
      fc.assert(
        fc.property(dec3, priceScaled, (a, p) => {
          const k = kg(a);
          const m = money(fromScaled(p, PRICE_SCALE));
          expect(kgFromDb(kgToDb(k)).equals(k)).toBe(true);
          expect(moneyFromDb(moneyToDb(m)).equals(m)).toBe(true);
        }),
      );
    });

    it('a decimal serialized as a JSON string parses back to an equal decimal', () => {
      fc.assert(
        fc.property(dec3, priceScaled, (a, p) => {
          const k = kg(a);
          const m = money(fromScaled(p, PRICE_SCALE));
          const wire = JSON.parse(JSON.stringify({ k: kgToDb(k), m: moneyToDb(m) })) as { k: string; m: string };
          expect(typeof wire.k).toBe('string');
          expect(typeof wire.m).toBe('string');
          expect(kg(wire.k).equals(k)).toBe(true);
          expect(money(wire.m).equals(m)).toBe(true);
        }),
      );
    });

    it('survives the maximum magnitudes of the database columns', () => {
      const maxKg = fromScaled(pow10(14) - 1n, KG_SCALE);
      const maxPrice = fromScaled(pow10(12) - 1n, PRICE_SCALE);
      expect(kgToDb(kgFromDb(maxKg))).toBe(maxKg);
      expect(moneyToDb(moneyFromDb(maxPrice))).toBe(maxPrice);
    });
  });

  describe('ROUND_HALF_UP', () => {
    // Model: input has `extra` more digits than `scale`. Non-negative half up = floor((n + half) / unit).
    const extraDigits = fc.integer({ min: 1, max: 6 });
    const modelRound = (n: bigint, extra: number): bigint => {
      const unit = pow10(extra);
      return (n + unit / 2n) / unit;
    };

    it.each([
      ['kg', KG_SCALE, (s: string) => kgToDb(kg(s))],
      ['money', PRICE_SCALE, (s: string) => moneyToDb(money(s))],
      ['total', TOTAL_SCALE, (s: string) => roundTotal(new D(s)).toFixed(TOTAL_SCALE)],
    ] as const)('%s rounds to its scale half up', (_name, scale, run) => {
      fc.assert(
        fc.property(fc.bigInt({ min: 0n, max: pow10(16) - 1n }), extraDigits, (n, extra) => {
          const input = fromScaled(n, scale + extra);
          expect(run(input)).toBe(fromScaled(modelRound(n, extra), scale));
        }),
      );
    });

    it('exact ties round up (away from zero), never to even', () => {
      fc.assert(
        fc.property(fc.bigInt({ min: 0n, max: pow10(10) - 1n }), (base) => {
          // base.xxx5 at 4 places is an exact tie at 3 places.
          const tie = `${fromScaled(base, KG_SCALE)}5`;
          expect(kgToDb(kg(tie))).toBe(fromScaled(base + 1n, KG_SCALE));
          expect(roundHalfUp(new D(`-${tie}`), KG_SCALE).toFixed(KG_SCALE)).toBe(
            `-${fromScaled(base + 1n, KG_SCALE)}`,
          );
        }),
      );
    });

    it('specific ties', () => {
      expect(kgToDb(kg('1.0005'))).toBe('1.001');
      expect(kgToDb(kg('1.0015'))).toBe('1.002');
      expect(kgToDb(kg('1.0004'))).toBe('1.000');
      expect(roundTotal(new D('2.345')).toFixed(2)).toBe('2.35');
      expect(roundTotal(new D('2.355')).toFixed(2)).toBe('2.36');
    });

    it('rounding is idempotent', () => {
      fc.assert(
        fc.property(fc.bigInt({ min: 0n, max: pow10(16) - 1n }), (n) => {
          const once = roundHalfUp(new D(fromScaled(n, 8)), KG_SCALE);
          expect(roundHalfUp(once, KG_SCALE).equals(once)).toBe(true);
        }),
      );
    });
  });

  describe('units other than kg and ton need confirmation', () => {
    const notSupported = fc.string().filter((u) => u !== 'kg' && u !== 'ton');

    it('returns NEEDS_CONFIRMATION and no number for any other unit', () => {
      fc.assert(
        fc.property(dec3, notSupported, (x, unit) => {
          const r = toKg({ value: x, unit });
          expect(r).toEqual({ ok: false, code: 'NEEDS_CONFIRMATION' });
          expect(r).not.toHaveProperty('kg');
        }),
      );
    });

    it('unit check comes before value check, so a bad value with a local unit still asks to confirm', () => {
      fc.assert(
        fc.property(fc.string(), notSupported, (value, unit) => {
          expect(toKg({ value, unit })).toEqual({ ok: false, code: 'NEEDS_CONFIRMATION' });
        }),
      );
    });

    it.each(['เกวียน', 'ไร่', 'งาน', 'bale', 'bales', 'KG', 'Kg', 'TON', 'Ton', 'tons', 'kgs', 't', ' kg', 'kg ', '', 'กก.', 'ตัน'])(
      'unit %j needs confirmation',
      (unit) => {
        expect(toKg({ value: '2', unit })).toEqual({ ok: false, code: 'NEEDS_CONFIRMATION' });
      },
    );
  });

  describe('no floating point', () => {
    it('values are Decimal instances, not JavaScript numbers', () => {
      fc.assert(
        fc.property(dec3, (x) => {
          const r = toKg({ value: x, unit: 'ton' });
          expect(r.ok).toBe(true);
          if (r.ok) {
            expect(typeof r.kg).toBe('object');
            expect(r.kg).toBeInstanceOf(D);
          }
        }),
      );
    });

    it('classic float traps stay exact', () => {
      const cases: Array<[string, string]> = [
        ['0.1', '100.000'],
        ['0.2', '200.000'],
        ['0.3', '300.000'],
        ['1.005', '1005.000'],
        ['4.35', '4350.000'],
        ['8.2', '8200.000'],
      ];
      for (const [tons, expected] of cases) {
        const r = toKg({ value: tons, unit: 'ton' });
        expect(r.ok && kgToDb(r.kg)).toBe(expected);
      }
      expect(new D('0.1').plus('0.2').equals(new D('0.3'))).toBe(true);
    });

    it('non-string, non-Decimal runtime values return INVALID_VALUE without throwing', () => {
      const nonDecimal = fc.oneof(
        fc.double(),
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.constant(undefined),
        fc.object(),
        fc.array(fc.integer()),
      );
      fc.assert(
        fc.property(nonDecimal, fc.constantFrom('kg', 'ton'), (v, unit) => {
          expect(toKg({ value: v as unknown as string, unit })).toEqual({ ok: false, code: 'INVALID_VALUE' });
          expect(parseDecimal(v as unknown as string)).toBeNull();
        }),
      );
      for (const v of [1.5, null, undefined, {}, true]) {
        expect(() => kg(v as unknown as string)).toThrow(TypeError);
        expect(() => money(v as unknown as string)).toThrow(TypeError);
      }
    });

    it('rejects exponent, NaN, Infinity and malformed strings', () => {
      for (const v of ['1e3', 'NaN', 'Infinity', '-Infinity', '', ' ', '1,5', '.5', '5.', '0x10', '--1', '1.2.3']) {
        expect(toKg({ value: v, unit: 'kg' })).toEqual({ ok: false, code: 'INVALID_VALUE' });
      }
    });
  });
});
