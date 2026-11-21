import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { filterOnly, filterPair, passingPairs } from '../src/matching/filter.js';
import { RULES_V1 } from '../src/matching/rules/v1.js';
import { EXCLUSION_CODES, type DemandSubject, type SupplySubject } from '../src/matching/types.js';

const day = (n: number): Date => new Date(Date.UTC(2026, 10, n));
// ~0.009 degrees of latitude is about 1 km.
const at = (km: number) => ({ lat: 16 + km / 111.195, lng: 100 });

const supply = (o: Partial<SupplySubject> = {}): SupplySubject => ({
  id: 's1', orgId: 'farm', published: true, material: 'RICE_STRAW', form: 'LOOSE',
  remainingKg: new Decimal(5000), minLotKg: null, window: { from: day(1), to: day(10) },
  location: at(0), province: 'Uttaradit', price: null, kind: 'SALE', ...o,
});
const demand = (o: Partial<DemandSubject> = {}): DemandSubject => ({
  id: 'd1', orgId: 'plant', published: true, material: 'RICE_STRAW', forms: ['LOOSE', 'BALED'],
  remainingKg: new Decimal(20000), minLotKg: new Decimal(1000), window: { from: day(5), to: day(20) },
  location: at(30), radiusKm: null, provinces: [], price: null, ...o,
});
const run = (s: SupplySubject, d: DemandSubject, route: 1 | 2 | 3 | 4 = 1) => filterPair(route, s, d, RULES_V1);

describe('filter stage', () => {
  it('passes a fully known compatible pair in tier 0 with straight-line distance', () => {
    const r = run(supply(), demand());
    expect(r.excluded).toEqual([]);
    expect(r.flags).toEqual([]);
    expect(r.tier).toBe(0);
    expect(r.distanceKind).toBe('straight_line');
    expect(Number(r.distanceKm)).toBeCloseTo(30, 0);
  });

  it.each([
    ['NOT_PUBLISHED', supply({ published: false }), demand()],
    ['NOT_PUBLISHED', supply(), demand({ published: false })],
    ['NO_REMAINING', supply({ remainingKg: new Decimal(0) }), demand()],
    ['NO_REMAINING', supply(), demand({ remainingKg: new Decimal(0) })],
    ['SAME_ORG', supply(), demand({ orgId: 'farm' })],
    ['MATERIAL_MISMATCH', supply({ material: 'CORN_STOVER' }), demand()],
    ['MATERIAL_MISMATCH', supply({ material: 'OTHER' }), demand({ material: 'OTHER' })],
    ['FORM_MISMATCH', supply({ form: 'CHOPPED' }), demand()],
    ['BELOW_MIN_LOT', supply({ remainingKg: new Decimal(999) }), demand()],
    ['WINDOW_NO_OVERLAP', supply({ window: { from: day(1), to: day(2) } }), demand()],
    ['AREA_MISMATCH', supply({ province: 'Nakhon Sawan' }), demand({ provinces: ['Uttaradit'] })],
    ['OVER_RADIUS', supply(), demand({ radiusKm: 20 })],
    ['OVER_MAX_TRANSPORT', supply({ location: at(0) }), demand({ location: at(81) })],
  ] as const)('excludes %s', (code, s, d) => {
    expect(run(s, d).excluded).toContain(code);
  });

  it('returns several codes in the fixed order', () => {
    const r = run(
      supply({ published: false, material: 'CORN_STOVER', remainingKg: new Decimal(10) }),
      demand({ orgId: 'farm', radiusKm: 5, location: at(90) }),
    );
    expect(r.excluded).toEqual(['NOT_PUBLISHED', 'SAME_ORG', 'MATERIAL_MISMATCH', 'BELOW_MIN_LOT', 'OVER_RADIUS', 'OVER_MAX_TRANSPORT']);
    expect(r.excluded).toEqual(EXCLUSION_CODES.filter((c) => r.excluded.includes(c)));
  });

  it('keeps the pair at exactly the cap and at exactly the buyer radius', () => {
    const d = filterPair(1, supply(), demand({ location: at(50) }), { ...RULES_V1, maxTransportKm: 50.5 });
    expect(d.excluded).toEqual([]);
    const exact = run(supply(), demand()).distanceExactKm as number;
    expect(run(supply(), demand({ radiusKm: exact })).excluded).toEqual([]);
  });

  it('applies the 80 km cap to routes 1, 2 and 4 but not route 3', () => {
    const far = demand({ location: at(120) });
    for (const route of [1, 2, 4] as const) expect(run(supply(), far, route).excluded).toContain('OVER_MAX_TRANSPORT');
    const r3 = run(supply({ kind: 'BALING_REQUEST' }), demand({ location: at(120), radiusKm: 150 }), 3);
    expect(r3.excluded).toEqual([]);
  });

  it('route 3 uses the service radius, then the province list, else asks to confirm', () => {
    const s = supply({ kind: 'BALING_REQUEST' });
    expect(run(s, demand({ radiusKm: 10 }), 3).excluded).toContain('AREA_MISMATCH');
    expect(run(s, demand({ radiusKm: 10 }), 3).excluded).not.toContain('OVER_RADIUS');
    const byProvince = run(s, demand({ location: null, provinces: ['Uttaradit'] }), 3);
    expect(byProvince.excluded).toEqual([]);
    expect(run(s, demand({ location: null, provinces: ['Phrae'] }), 3).excluded).toContain('AREA_MISMATCH');
    const unknown = run(s, demand({ location: null, provinces: [] }), 3);
    expect(unknown.excluded).toEqual([]);
    expect(unknown.flags).toContainEqual({ code: 'NEEDS_CONFIRMATION', field: 'area' });
  });

  it('route 3 does not filter on form', () => {
    const r = run(supply({ kind: 'BALING_REQUEST', form: null }), demand({ forms: [] }), 3);
    expect(r.excluded).not.toContain('FORM_MISMATCH');
    expect(r.flags).not.toContainEqual({ code: 'NEEDS_CONFIRMATION', field: 'form' });
  });

  it('missing data never excludes: it flags, sets tier 1 and makes no distance claim', () => {
    const r = run(
      supply({ form: null, window: null, location: null, province: null }),
      demand({ provinces: ['Uttaradit'], radiusKm: 5 }),
    );
    expect(r.excluded).toEqual([]);
    expect(r.flags).toEqual([
      { code: 'NEEDS_CONFIRMATION', field: 'form' },
      { code: 'NEEDS_CONFIRMATION', field: 'window' },
      { code: 'NEEDS_CONFIRMATION', field: 'area' },
      { code: 'DISTANCE_UNVERIFIED' },
    ]);
    expect(r.distanceKm).toBeNull();
    expect(r.distanceKind).toBeNull();
    expect(r.tier).toBe(1);
  });

  it('treats invalid coordinates as unknown instead of throwing', () => {
    const r = run(supply({ location: { lat: 200, lng: 0 } }), demand());
    expect(r.excluded).toEqual([]);
    expect(r.flags).toContainEqual({ code: 'DISTANCE_UNVERIFIED' });
  });

  it('filterOnly lists all pairs with codes and passingPairs keeps only passing ones', () => {
    const input = {
      route: 1 as const,
      supplies: [supply({ id: 's1' }), supply({ id: 's2', material: 'CORN_STOVER' })],
      demands: [demand()],
      config: RULES_V1,
      now: day(1),
    };
    const all = filterOnly(input);
    expect(all.map((o) => [o.supplyId, o.excluded.length > 0])).toEqual([['s1', false], ['s2', true]]);
    expect(passingPairs(input).map((o) => o.supplyId)).toEqual(['s1']);
  });
});
