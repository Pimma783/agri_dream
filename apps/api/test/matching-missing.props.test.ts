import { Decimal } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { filterPair } from '../src/matching/filter.js';
import { RULES_V1 } from '../src/matching/rules/v1.js';
import { scorePair } from '../src/matching/score.js';
import {
  TRADE_COMPONENT_KEYS,
  type DemandSubject,
  type Flag,
  type Route,
  type SupplySubject,
} from '../src/matching/types.js';

// Feature: agrimatch-mvp, Property 4: Missing data never counts as a pass
// **Validates: Requirements 9.6, 9.8, 10.5**

const RUNS = { numRuns: 200 };
const day = (n: number): Date => new Date(Date.UTC(2026, 10, n));
const CFG = RULES_V1;

// A pair that passes every check with every input known (distance ~33 km).
const supply = (o: Partial<SupplySubject> = {}): SupplySubject => ({
  id: 's1', orgId: 'farm', published: true, material: 'RICE_STRAW', form: 'LOOSE',
  remainingKg: new Decimal(5000), minLotKg: null, window: { from: day(1), to: day(10) },
  location: { lat: 16, lng: 100 }, province: 'Uttaradit', price: null, kind: 'SALE', ...o,
});
const demand = (o: Partial<DemandSubject> = {}): DemandSubject => ({
  id: 'd1', orgId: 'plant', published: true, material: 'RICE_STRAW', forms: ['LOOSE', 'BALED'],
  remainingKg: new Decimal(20000), minLotKg: null, window: { from: day(5), to: day(20) },
  location: { lat: 16.3, lng: 100 }, radiusKm: 60, provinces: ['Uttaradit'], price: null, ...o,
});

const hasFlag = (flags: readonly Flag[], code: Flag['code'], field?: string): boolean =>
  flags.some((f) => f.code === code && (field === undefined || (f.code === 'NEEDS_CONFIRMATION' && f.field === field)));

const anyRoute = fc.constantFrom<Route>(1, 2, 3, 4);
const tradeRoute = fc.constantFrom<Route>(1, 2, 4);
// Jitter that keeps the base pair passing: small shifts of the buyer position and window end.
const jitter = fc.record({
  dLat: fc.double({ min: -0.1, max: 0.1, noNaN: true }),
  endDay: fc.integer({ min: 6, max: 28 }),
});
const variant = (j: { dLat: number; endDay: number }) => ({
  s: supply(),
  d: demand({ location: { lat: 16.3 + j.dLat, lng: 100 }, window: { from: day(5), to: day(j.endDay) } }),
});

describe('Property 4: missing data never counts as a pass', () => {
  it('the fully known base pair passes with tier 0 and no flags (control)', () => {
    fc.assert(
      fc.property(anyRoute, jitter, (route, j) => {
        const { s, d } = variant(j);
        const f = filterPair(route, s, d, CFG);
        expect(f.excluded).toEqual([]);
        expect(f.flags).toEqual([]);
        expect(f.tier).toBe(0);
      }),
      RUNS,
    );
  });

  it('unknown form: no exclusion, NEEDS_CONFIRMATION(form), tier 1 (routes 1, 2, 4)', () => {
    fc.assert(
      fc.property(tradeRoute, jitter, fc.boolean(), (route, j, supplySide) => {
        const { s, d } = variant(j);
        const [s2, d2] = supplySide ? [{ ...s, form: null }, d] : [s, { ...d, forms: [] }];
        const f = filterPair(route, s2, d2, CFG);
        expect(f.excluded).toEqual([]);
        expect(hasFlag(f.flags, 'NEEDS_CONFIRMATION', 'form')).toBe(true);
        expect(f.tier).toBe(1);
        const m = scorePair(route, s2, d2, CFG, f);
        expect(m.tier).toBe(1);
        expect(hasFlag(m.flags, 'NEEDS_CONFIRMATION', 'form')).toBe(true);
      }),
      RUNS,
    );
  });

  it('unknown time window: no exclusion, NEEDS_CONFIRMATION(window), tier 1, time unknown', () => {
    fc.assert(
      fc.property(anyRoute, jitter, fc.boolean(), fc.boolean(), (route, j, sNull, dNull) => {
        fc.pre(sNull || dNull);
        const { s, d } = variant(j);
        const s2 = sNull ? { ...s, window: null } : s;
        const d2 = dNull ? { ...d, window: null } : d;
        const f = filterPair(route, s2, d2, CFG);
        expect(f.excluded).toEqual([]);
        expect(hasFlag(f.flags, 'NEEDS_CONFIRMATION', 'window')).toBe(true);
        expect(f.tier).toBe(1);
        const m = scorePair(route, s2, d2, CFG, f);
        expect(m.tier).toBe(1);
        expect(m.components.time?.value).toBeNull();
        expect(m.reasons.some((r) => r.code === 'WINDOW_OVERLAP_DAYS')).toBe(false);
        expect(m.reasons.some((r) => r.code === 'MISSING_TIME')).toBe(true);
      }),
      RUNS,
    );
  });

  it('unknown area (province, and no coordinates on route 3): no exclusion, NEEDS_CONFIRMATION(area), tier 1', () => {
    fc.assert(
      fc.property(tradeRoute, jitter, (route, j) => {
        const { s, d } = variant(j);
        const s2 = { ...s, province: null };
        const f = filterPair(route, s2, d, CFG);
        expect(f.excluded).toEqual([]);
        expect(hasFlag(f.flags, 'NEEDS_CONFIRMATION', 'area')).toBe(true);
        expect(f.tier).toBe(1);
      }),
      RUNS,
    );
    fc.assert(
      fc.property(jitter, fc.boolean(), (j, noCoordsOnSupply) => {
        const { s, d } = variant(j);
        const s2 = { ...s, province: null, ...(noCoordsOnSupply ? { location: null } : {}) };
        const d2 = noCoordsOnSupply ? d : { ...d, location: null };
        const f = filterPair(3, s2, d2, CFG);
        expect(f.excluded).toEqual([]);
        expect(hasFlag(f.flags, 'NEEDS_CONFIRMATION', 'area')).toBe(true);
        expect(f.tier).toBe(1);
      }),
      RUNS,
    );
  });

  it('missing coordinates on either side: distance null, DISTANCE_UNVERIFIED, no radius or cap claim, no distance reason', () => {
    fc.assert(
      fc.property(anyRoute, jitter, fc.boolean(), fc.boolean(), (route, j, sNull, dNull) => {
        fc.pre(sNull || dNull);
        const { s, d } = variant(j);
        // A tiny radius and cap would exclude any known distance; unknown distance must not.
        const cfg = { ...CFG, maxTransportKm: 0.001 };
        const s2 = sNull ? { ...s, location: null } : s;
        const d2 = { ...(dNull ? { ...d, location: null } : d), radiusKm: 0.001 };
        const f = filterPair(route, s2, d2, cfg);
        expect(f.distanceKm).toBeNull();
        expect(f.distanceExactKm).toBeNull();
        expect(f.distanceKind).toBeNull();
        expect(hasFlag(f.flags, 'DISTANCE_UNVERIFIED')).toBe(true);
        expect(f.excluded).not.toContain('OVER_RADIUS');
        expect(f.excluded).not.toContain('OVER_MAX_TRANSPORT');
        expect(f.tier).toBe(1);
        const m = scorePair(route, s2, d2, cfg, f);
        expect(m.distanceKm).toBeNull();
        expect(m.distanceKind).toBeNull();
        expect(m.tier).toBe(1);
        expect(hasFlag(m.flags, 'DISTANCE_UNVERIFIED')).toBe(true);
        expect(m.reasons.some((r) => r.code === 'DISTANCE_KM')).toBe(false);
        expect(m.components.distance?.value ?? null).toBeNull();
      }),
      RUNS,
    );
  });

  it('out-of-range coordinates are treated as missing, not as a pass', () => {
    fc.assert(
      fc.property(
        tradeRoute,
        fc.oneof(
          fc.record({ lat: fc.double({ min: 90.01, max: 1000, noNaN: true }), lng: fc.constant(100) }),
          fc.record({ lat: fc.constant(16), lng: fc.double({ min: 180.01, max: 1000, noNaN: true }) }),
        ),
        (route, bad) => {
          const f = filterPair(route, supply({ location: bad }), demand(), CFG);
          expect(f.distanceKm).toBeNull();
          expect(hasFlag(f.flags, 'DISTANCE_UNVERIFIED')).toBe(true);
          expect(f.tier).toBe(1);
        },
      ),
      RUNS,
    );
  });

  it('unknown inputs never turn a pass into an exclusion, and never remove a flag-free pair from tier 1 rules', () => {
    const nullable = fc.record({
      form: fc.boolean(),
      sWindow: fc.boolean(),
      dWindow: fc.boolean(),
      province: fc.boolean(),
      sLoc: fc.boolean(),
      dLoc: fc.boolean(),
    });
    fc.assert(
      fc.property(tradeRoute, jitter, nullable, (route, j, n) => {
        const { s, d } = variant(j);
        const s2 = {
          ...s,
          form: n.form ? null : s.form,
          window: n.sWindow ? null : s.window,
          province: n.province ? null : s.province,
          location: n.sLoc ? null : s.location,
        };
        const d2 = { ...d, window: n.dWindow ? null : d.window, location: n.dLoc ? null : d.location };
        const f = filterPair(route, s2, d2, CFG);
        expect(f.excluded).toEqual([]);
        const anyUnknown = Object.values(n).some(Boolean);
        expect(f.tier).toBe(anyUnknown ? 1 : 0);
        expect(f.flags.length > 0).toBe(anyUnknown);
      }),
      RUNS,
    );
  });
});

// Scoring: unknown components are reweighted, never scored as 0, and flagged INCOMPLETE.
const priceArb = fc.oneof(
  fc.constant(null),
  fc.constant({ negotiable: true, amount: null, unit: null } as const),
  fc.constant({ negotiable: false, amount: new Decimal(2), unit: 'THB_PER_BALE' } as const), // not convertible
  fc.integer({ min: 1, max: 5000 }).map((n) => ({ negotiable: false, amount: new Decimal(n).div(1000), unit: 'THB_PER_KG' as const })),
);
const transportArb = fc.constantFrom(null, 'SELLER_DELIVERS', 'BUYER_PICKS_UP', 'EITHER' as const);

describe('Property 4: unknown components are reweighted, flagged INCOMPLETE, never zero', () => {
  it('weightCoverage is the sum of known weights; INCOMPLETE iff coverage < 1; unknown values are null with a MISSING reason', () => {
    fc.assert(
      fc.property(
        tradeRoute, jitter, fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(), priceArb, priceArb, transportArb, transportArb,
        (route, j, sLoc, dLoc, sWin, dWin, sPrice, dPrice, sTr, dTr) => {
          const { s, d } = variant(j);
          const s2: SupplySubject = {
            ...s,
            location: sLoc ? s.location : null,
            window: sWin ? s.window : null,
            price: sPrice,
            transport: sTr,
          };
          const d2: DemandSubject = {
            ...d,
            location: dLoc ? d.location : null,
            window: dWin ? d.window : null,
            price: dPrice,
            transport: dTr,
          };
          const f = filterPair(route, s2, d2, CFG);
          expect(f.excluded).toEqual([]);
          const m = scorePair(route, s2, d2, CFG, f);

          const kg = (p: typeof sPrice): boolean => p !== null && !p.negotiable && p.unit === 'THB_PER_KG';
          const known: Record<(typeof TRADE_COMPONENT_KEYS)[number], boolean> = {
            distance: sLoc && dLoc,
            quantity: true,
            price: kg(sPrice) && kg(dPrice),
            time: sWin && dWin,
            conditions: sTr !== null && dTr !== null,
          };
          let expectedCoverage = new Decimal(0);
          for (const k of TRADE_COMPONENT_KEYS) {
            const comp = m.components[k];
            expect(comp).toBeDefined();
            if (known[k]) {
              expectedCoverage = expectedCoverage.plus(CFG.trade[k]);
              expect(comp?.value).not.toBeNull();
              expect(m.reasons.some((r) => r.code.startsWith('MISSING_') && r.params['component'] === k)).toBe(false);
            } else {
              expect(comp?.value).toBeNull();
              expect(m.reasons.some((r) => r.code.startsWith('MISSING_') && r.params['component'] === k)).toBe(true);
            }
          }
          expect(m.weightCoverage).toBe(expectedCoverage.toFixed(4));
          expect(hasFlag(m.flags, 'INCOMPLETE')).toBe(expectedCoverage.lessThan(1));
          expect(m.tier).toBe(expectedCoverage.lessThan(1) || f.tier === 1 ? 1 : 0);
          const score = new Decimal(m.score);
          expect(score.greaterThanOrEqualTo(0) && score.lessThanOrEqualTo(100)).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it('every known component carries its weight; only the known ones are renormalized in the score', () => {
    fc.assert(
      fc.property(tradeRoute, jitter, fc.boolean(), fc.boolean(), (route, j, sWin, dWin) => {
        const { s, d } = variant(j);
        const s2 = { ...s, window: sWin ? s.window : null };
        const d2 = { ...d, window: dWin ? d.window : null };
        const m = scorePair(route, s2, d2, CFG);
        let weighted = new Decimal(0);
        let cov = new Decimal(0);
        for (const k of TRADE_COMPONENT_KEYS) {
          const v = m.components[k]?.value ?? null;
          if (v === null) continue;
          weighted = weighted.plus(new Decimal(CFG.trade[k]).times(v));
          cov = cov.plus(CFG.trade[k]);
        }
        const expected = cov.isZero() ? new Decimal(0) : weighted.div(cov).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        expect(m.score).toBe(expected.toFixed(2));
      }),
      RUNS,
    );
  });

  it('no known component: score 0, INCOMPLETE, tier 1, weightCoverage 0 (all routes)', () => {
    fc.assert(
      fc.property(anyRoute, (route) => {
        const s = supply({ location: null, window: null, price: null, province: null, form: null });
        const d = demand({
          location: null, window: null, price: null, radiusKm: null, provinces: [], forms: [],
          remainingKg: new Decimal(0),
        });
        // Route 3 scores quantity only from capacity; trade routes from remaining kg. Zero remaining makes it unknown.
        const m = scorePair(route, s, d, CFG);
        expect(m.score).toBe('0.00');
        expect(m.weightCoverage).toBe('0.0000');
        expect(hasFlag(m.flags, 'INCOMPLETE')).toBe(true);
        expect(m.tier).toBe(1);
        for (const c of Object.values(m.components)) expect(c?.value).toBeNull();
        expect(m.reasons.every((r) => r.code.startsWith('MISSING_'))).toBe(true);
      }),
      RUNS,
    );
  });
});

describe('Property 4/7: the engine fabricates nothing from missing data', () => {
  it('reasons only cite inputs that exist: no window, price or distance reason when the input is absent', () => {
    fc.assert(
      fc.property(tradeRoute, jitter, priceArb, priceArb, fc.boolean(), (route, j, sPrice, dPrice, noLoc) => {
        const { s, d } = variant(j);
        const s2 = { ...s, price: sPrice, location: noLoc ? null : s.location, window: null };
        const m = scorePair(route, s2, { ...d, price: dPrice }, CFG);
        const codes = m.reasons.map((r) => r.code);
        expect(codes).not.toContain('WINDOW_OVERLAP_DAYS');
        if (noLoc) expect(codes).not.toContain('DISTANCE_KM');
        const priceKnown = (p: typeof sPrice) => p !== null && !p.negotiable && p.unit === 'THB_PER_KG';
        if (!(priceKnown(sPrice) && priceKnown(dPrice))) {
          expect(codes).not.toContain('PRICE_WITHIN_BUDGET');
          expect(codes).not.toContain('PRICE_ABOVE_BUDGET');
          expect(hasFlag(m.flags, 'PRICE_MISMATCH')).toBe(false);
        }
        expect(m.supplyId).toBe(s.id);
        expect(m.demandId).toBe(d.id);
      }),
      RUNS,
    );
  });
});
