import { Decimal } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { renderFlagTh, renderReasonTh, renderReasonsTh, WEIGHTS_DISCLAIMER_TH } from '../src/matching/explain.th.js';
import { RULES_V1 } from '../src/matching/rules/v1.js';
import { rankMatches, runMatching, scorePair } from '../src/matching/score.js';
import type { DemandSubject, MatchResult, SupplySubject } from '../src/matching/types.js';

const day = (n: number): Date => new Date(Date.UTC(2026, 10, n));
const here = { lat: 16, lng: 100 };
const at = (km: number) => ({ lat: 16 + km / 111.195, lng: 100 });
const dec = (n: number | string) => new Decimal(n);

const supply = (o: Partial<SupplySubject> = {}): SupplySubject => ({
  id: 's1', orgId: 'farm', published: true, material: 'RICE_STRAW', form: 'LOOSE',
  remainingKg: dec(5000), minLotKg: null, window: { from: day(1), to: day(10) },
  location: here, province: 'Uttaradit', price: null, kind: 'SALE', ...o,
});
const demand = (o: Partial<DemandSubject> = {}): DemandSubject => ({
  id: 'd1', orgId: 'plant', published: true, material: 'RICE_STRAW', forms: ['LOOSE'],
  remainingKg: dec(20000), minLotKg: null, window: { from: day(5), to: day(20) },
  location: here, radiusKm: null, provinces: [], price: null, ...o,
});
const kgPrice = (n: number) => ({ negotiable: false, amount: dec(n), unit: 'THB_PER_KG' as const });
const score = (s: SupplySubject, d: DemandSubject, route: 1 | 2 | 3 | 4 = 1): MatchResult =>
  scorePair(route, s, d, RULES_V1);

describe('trade scoring (routes 1, 2, 4)', () => {
  it('renormalizes over known components and reports weightCoverage and INCOMPLETE', () => {
    const r = score(supply(), demand());
    // distance 1, quantity 1, time 5/9 = 0.5556; price and conditions unknown
    expect(r.components.distance).toEqual({ value: '1.0000', weight: '0.30' });
    expect(r.components.quantity?.value).toBe('1.0000');
    expect(r.components.time?.value).toBe('0.5556');
    expect(r.components.price?.value).toBeNull();
    expect(r.components.conditions?.value).toBeNull();
    expect(r.weightCoverage).toBe('0.7000');
    expect(r.score).toBe('90.48');
    expect(r.flags).toContainEqual({ code: 'INCOMPLETE' });
    expect(r.tier).toBe(1);
    expect(r.ruleVersion).toBe(RULES_V1.version);
  });

  it('gives 100, coverage 1 and tier 0 when everything is known and favourable', () => {
    const r = score(
      supply({ window: { from: day(1), to: day(10) }, price: kgPrice(8), moisturePct: dec(15), transport: 'EITHER' }),
      demand({ window: { from: day(1), to: day(10) }, price: kgPrice(10), maxMoisturePct: dec(20), transport: 'BUYER_PICKS_UP' }),
    );
    expect(r.score).toBe('100.00');
    expect(r.weightCoverage).toBe('1.0000');
    expect(r.flags).toEqual([]);
    expect(r.tier).toBe(0);
  });

  it('scores distance as 1 - d/cap using the smaller of the cap and the buyer radius', () => {
    const r = score(supply(), demand({ location: at(40) }));
    expect(Number(r.components.distance?.value)).toBeCloseTo(0.5, 3);
    const r2 = score(supply(), demand({ location: at(40), radiusKm: 50 }));
    expect(Number(r2.components.distance?.value)).toBeCloseTo(0.2, 3);
    expect(r2.distanceKind).toBe('straight_line');
  });

  it('scores quantity as min(L, D) / L', () => {
    expect(score(supply({ remainingKg: dec(10000) }), demand({ remainingKg: dec(2500) })).components.quantity?.value).toBe('0.2500');
  });

  it('scores price: within budget 1, above decays, far above 0, per-ton normalized', () => {
    const p = (a: number, m: number) => score(supply({ price: kgPrice(a) }), demand({ price: kgPrice(m) }));
    expect(p(8, 10).components.price?.value).toBe('1.0000');
    expect(p(15, 10).components.price?.value).toBe('0.5000');
    expect(p(25, 10).components.price?.value).toBe('0.0000');
    expect(p(15, 10).flags).toContainEqual({ code: 'PRICE_MISMATCH' });
    const ton = score(
      supply({ price: { negotiable: false, amount: dec(8000), unit: 'THB_PER_TON' } }),
      demand({ price: kgPrice(10) }),
    );
    expect(ton.components.price?.value).toBe('1.0000');
  });

  it('treats NEGOTIABLE, missing, zero-amount-null and per-bale prices as unknown, not 0', () => {
    const neg = { negotiable: true, amount: null, unit: null };
    const bale = { negotiable: false, amount: dec(100), unit: 'THB_PER_BALE' as const };
    for (const [a, b] of [[neg, kgPrice(10)], [kgPrice(8), neg], [bale, kgPrice(10)], [null, kgPrice(10)]] as const) {
      const r = score(supply({ price: a }), demand({ price: b }));
      expect(r.components.price?.value).toBeNull();
      expect(r.reasons.map((x) => x.code)).toContain('MISSING_PRICE');
      expect(r.flags).not.toContainEqual({ code: 'PRICE_MISMATCH' });
    }
  });

  it('scores conditions as pass / (pass + fail) over decidable checks only', () => {
    const r = score(
      supply({ transport: 'SELLER_DELIVERS', moisturePct: dec(25) }),
      demand({ transport: 'SELLER_DELIVERS', maxMoisturePct: dec(20) }),
    );
    expect(r.components.conditions?.value).toBe('0.5000');
    expect(score(supply({ transport: 'SELLER_DELIVERS' }), demand({ transport: 'BUYER_PICKS_UP' })).components.conditions?.value).toBe('0.0000');
  });

  it('leaves distance unknown without coordinates and keeps DISTANCE_UNVERIFIED, tier 1, no distance reason', () => {
    const r = score(supply({ location: null }), demand());
    expect(r.components.distance?.value).toBeNull();
    expect(r.distanceKm).toBeNull();
    expect(r.flags).toContainEqual({ code: 'DISTANCE_UNVERIFIED' });
    expect(r.reasons.map((x) => x.code)).not.toContain('DISTANCE_KM');
    expect(r.tier).toBe(1);
  });

  it('keeps score 0 with INCOMPLETE and tier 1 when no component is known', () => {
    const r = score(
      supply({ location: null, window: null, remainingKg: dec(0) }),
      demand({ location: null, window: null }),
    );
    expect(r.score).toBe('0.00');
    expect(r.weightCoverage).toBe('0.0000');
    expect(r.flags).toContainEqual({ code: 'INCOMPLETE' });
    expect(r.tier).toBe(1);
  });

  it('emits reasons in the fixed order with MISSING_* last', () => {
    const r = score(supply({ price: kgPrice(8) }), demand({ price: kgPrice(10) }));
    expect(r.reasons.map((x) => x.code)).toEqual([
      'DISTANCE_KM', 'QTY_COVERAGE', 'PRICE_WITHIN_BUDGET', 'WINDOW_OVERLAP_DAYS', 'MISSING_CONDITIONS',
    ]);
    const above = score(supply({ price: kgPrice(15) }), demand({ price: kgPrice(10) }));
    expect(above.reasons.map((x) => x.code)).toContain('PRICE_ABOVE_BUDGET');
  });

  it('uses the same trade weights for routes 1, 2 and 4', () => {
    const base = score(supply(), demand(), 1);
    for (const route of [2, 4] as const) expect(score(supply(), demand(), route).score).toBe(base.score);
  });
});

describe('baling scoring (route 3)', () => {
  const request = (o: Partial<SupplySubject> = {}) =>
    supply({ id: 'r1', kind: 'BALING_REQUEST', remainingKg: dec(5000), balingMode: 'ON_SITE', baleFormat: 'ROUND', ...o });
  const service = (o: Partial<DemandSubject> = {}) =>
    demand({
      id: 'v1', forms: [], radiusKm: 50, balingModes: ['ON_SITE'], baleFormats: ['SQUARE'],
      capacityKg: dec(2500), window: { from: day(1), to: day(10) }, ...o,
    });

  it('computes the five service components with their weights', () => {
    const r = score(request(), service({ location: at(25) }), 3);
    expect(Number(r.components.serviceArea?.value)).toBeCloseTo(0.5, 3); // 1 - 25/50
    expect(r.components.serviceArea?.weight).toBe('0.35');
    expect(r.components.materialForm?.value).toBe('0.5000'); // mode met, format not
    expect(r.components.time?.value).toBe('1.0000');
    expect(r.components.quantity?.value).toBe('0.5000'); // capacity 2500 / request 5000
    expect(r.components.price?.value).toBeNull();
    expect(r.weightCoverage).toBe('0.9000');
    expect(r.flags).toContainEqual({ code: 'INCOMPLETE' });
  });

  it('uses the province list when coordinates are missing and treats unknown area as unknown', () => {
    const noGeo = { location: null };
    expect(score(request({ ...noGeo }), service({ ...noGeo, radiusKm: null, provinces: ['Uttaradit'] }), 3).components.serviceArea?.value).toBe('1.0000');
    expect(score(request({ ...noGeo }), service({ ...noGeo, radiusKm: null }), 3).components.serviceArea?.value).toBeNull();
  });

  it('compares the request budget with the service price and treats per-bale as unknown', () => {
    const ok = score(request({ price: kgPrice(2) }), service({ price: kgPrice(1.5) }), 3);
    expect(ok.components.price?.value).toBe('1.0000');
    const over = score(request({ price: kgPrice(2) }), service({ price: kgPrice(3) }), 3);
    expect(over.components.price?.value).toBe('0.5000');
    expect(over.flags).toContainEqual({ code: 'PRICE_MISMATCH' });
    const bale = score(request({ price: kgPrice(2) }), service({ price: { negotiable: false, amount: dec(50), unit: 'THB_PER_BALE' } }), 3);
    expect(bale.components.price?.value).toBeNull();
  });

  it('caps quantity at 1 and leaves it unknown without capacity', () => {
    expect(score(request(), service({ capacityKg: dec(99999) }), 3).components.quantity?.value).toBe('1.0000');
    expect(score(request(), service({ capacityKg: null }), 3).components.quantity?.value).toBeNull();
  });

  it('does not apply the 80 km cap to the distance reason on route 3 and still reports straight-line km', () => {
    const r = score(request(), service({ location: at(120), radiusKm: 150 }), 3);
    expect(r.distanceKind).toBe('straight_line');
    expect(r.reasons[0]?.code).toBe('DISTANCE_KM');
  });
});

describe('ranking and determinism', () => {
  const res = (supplyId: string, demandId: string, tier: 0 | 1, sc: string): MatchResult => ({
    route: 1, supplyId, demandId, ruleVersion: 'v', score: sc, components: {}, weightCoverage: '1.0000',
    flags: [], distanceKm: null, distanceKind: null, reasons: [], tier,
  });

  it('puts tier 0 before tier 1 whatever the score, then score desc, then stable ids', () => {
    const ranked = rankMatches([
      res('b', 'x', 1, '99.00'), res('b', 'a', 0, '50.00'), res('a', 'z', 0, '50.00'), res('c', 'c', 0, '60.00'),
    ]);
    expect(ranked.map((r) => `${r.supplyId}${r.demandId}`)).toEqual(['cc', 'az', 'ba', 'bx']);
  });

  it('runMatching omits excluded pairs, ranks the rest and does not mutate its input', () => {
    const supplies = [supply({ id: 's2' }), supply({ id: 's1' })];
    const demands = [demand({ id: 'd2', material: 'CORN_STOVER' }), demand({ id: 'd1' })];
    const input = { route: 1 as const, supplies, demands, config: RULES_V1, now: day(1) };
    const out = runMatching(input);
    expect(out.map((r) => [r.supplyId, r.demandId])).toEqual([['s1', 'd1'], ['s2', 'd1']]);
    expect(supplies.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(runMatching(input)).toEqual(out);
  });

  it('property: score stays in [0,100], components in [0,1], same input gives the same output', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }), fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 0, max: 80 }), fc.option(fc.integer({ min: 1, max: 40 }), { nil: null }),
        (l, dq, km, ask) => {
          const s = supply({ remainingKg: dec(l), price: ask === null ? null : kgPrice(ask) });
          const d = demand({ remainingKg: dec(dq), location: at(km), price: kgPrice(10) });
          const a = scorePair(1, s, d, RULES_V1);
          const b = scorePair(1, s, d, RULES_V1);
          expect(a).toEqual(b);
          expect(Number(a.score)).toBeGreaterThanOrEqual(0);
          expect(Number(a.score)).toBeLessThanOrEqual(100);
          for (const c of Object.values(a.components)) {
            if (c.value !== null) expect(Number(c.value)).toBeGreaterThanOrEqual(0);
            if (c.value !== null) expect(Number(c.value)).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Thai explanations', () => {
  it('says straight line for distance and cites the numbers', () => {
    const r = score(supply({ price: kgPrice(8) }), demand({ location: at(30), price: kgPrice(10) }));
    const lines = renderReasonsTh(r.reasons);
    expect(lines[0]).toContain('ระยะเส้นตรง');
    expect(lines[0]).toContain('ไม่ใช่ระยะขับรถ');
    expect(lines.join('\n')).toContain('8.0000');
    expect(renderReasonsTh(r.reasons)).toEqual(lines);
  });

  it('renders missing components, flags and the demo-weights disclaimer', () => {
    expect(renderReasonTh({ code: 'MISSING_PRICE', params: { component: 'price' } })).toContain('ราคา');
    expect(renderFlagTh({ code: 'INCOMPLETE' })).toBe('ข้อมูลไม่ครบ');
    expect(renderFlagTh({ code: 'NEEDS_CONFIRMATION', field: 'window' })).toContain('ต้องสอบถาม');
    expect(WEIGHTS_DISCLAIMER_TH).toContain('เดโม');
  });
});
