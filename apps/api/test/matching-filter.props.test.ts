import { Decimal } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_KM, haversineKm } from '../src/domain/distance.js';
import { filterPair } from '../src/matching/filter.js';
import { RULES_V1 } from '../src/matching/rules/v1.js';
import {
  EXCLUSION_CODES,
  MATERIALS,
  type DemandSubject,
  type GeoPoint,
  type Route,
  type SupplySubject,
} from '../src/matching/types.js';

// Feature: agrimatch-mvp, Property 3: Filter soundness and cap
// **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.11, 6.7**

const RUNS = { numRuns: 200 };
const day = (n: number): Date => new Date(Date.UTC(2026, 10, n));

/** Point `km` due north of `p` (same meridian, so Haversine is R * dLat). */
const north = (p: GeoPoint, km: number): GeoPoint => ({
  lat: p.lat + ((km / EARTH_RADIUS_KM) * 180) / Math.PI,
  lng: p.lng,
});

const baseArb = fc.record({
  lat: fc.double({ min: -60, max: 60, noNaN: true }),
  lng: fc.double({ min: -170, max: 170, noNaN: true }),
});

const supply = (o: Partial<SupplySubject> = {}): SupplySubject => ({
  id: 's1', orgId: 'farm', published: true, material: 'RICE_STRAW', form: 'LOOSE',
  remainingKg: new Decimal(5000), minLotKg: null, window: { from: day(1), to: day(10) },
  location: { lat: 16, lng: 100 }, province: 'Uttaradit', price: null, kind: 'SALE', ...o,
});
const demand = (o: Partial<DemandSubject> = {}): DemandSubject => ({
  id: 'd1', orgId: 'plant', published: true, material: 'RICE_STRAW', forms: ['LOOSE', 'BALED'],
  remainingKg: new Decimal(20000), minLotKg: null, window: { from: day(5), to: day(20) },
  location: { lat: 16.3, lng: 100 }, radiusKm: null, provinces: [], price: null, ...o,
});
const run = (route: Route, s: SupplySubject, d: DemandSubject, cap = RULES_V1.maxTransportKm) =>
  filterPair(route, s, d, { ...RULES_V1, maxTransportKm: cap });

const capRoute = fc.constantFrom<Route>(1, 2, 4);
const anyRoute = fc.constantFrom<Route>(1, 2, 3, 4);

describe('Property 3: filter soundness and 80 km cap', () => {
  it('uses an 80 km default cap', () => {
    expect(RULES_V1.maxTransportKm).toBe(80);
  });

  it('routes 1, 2, 4: OVER_MAX_TRANSPORT iff straight-line distance exceeds the cap', () => {
    fc.assert(
      fc.property(baseArb, fc.double({ min: 0, max: 400, noNaN: true }), capRoute, (base, km, route) => {
        const r = run(route, supply({ location: base }), demand({ location: north(base, km) }));
        expect(r.distanceExactKm).not.toBeNull();
        const exact = r.distanceExactKm as number;
        expect(r.excluded.includes('OVER_MAX_TRANSPORT')).toBe(exact > 80);
      }),
      RUNS,
    );
  });

  it('keeps pairs below 80 km and excludes pairs at 80.01 km or more, on routes 1, 2, 4', () => {
    fc.assert(
      fc.property(
        baseArb,
        fc.double({ min: 0, max: 79.99, noNaN: true }),
        fc.double({ min: 80.01, max: 500, noNaN: true }),
        capRoute,
        (base, near, far, route) => {
          const s = supply({ location: base });
          expect(run(route, s, demand({ location: north(base, near) })).excluded).not.toContain('OVER_MAX_TRANSPORT');
          expect(run(route, s, demand({ location: north(base, far) })).excluded).toContain('OVER_MAX_TRANSPORT');
        },
      ),
      RUNS,
    );
  });

  it('a distance exactly equal to the cap passes; one just above is excluded', () => {
    fc.assert(
      fc.property(baseArb, capRoute, (base, route) => {
        const loc = north(base, 80);
        const exact = haversineKm(base, loc);
        const s = supply({ location: base });
        const d = demand({ location: loc });
        // Cap set to the exact computed distance (exactly 80.0 in the model) must pass.
        expect(run(route, s, d, exact).excluded).not.toContain('OVER_MAX_TRANSPORT');
        // Any cap strictly below the distance excludes.
        expect(run(route, s, d, exact - 0.01).excluded).toContain('OVER_MAX_TRANSPORT');
        // A real 80.0 km pair is within float noise of the cap; 80.01 is always out.
        expect(run(route, s, demand({ location: north(base, 80.01) })).excluded).toContain('OVER_MAX_TRANSPORT');
      }),
      RUNS,
    );
  });

  it('the cap never applies to route 3', () => {
    fc.assert(
      fc.property(baseArb, fc.double({ min: 0, max: 400, noNaN: true }), (base, km) => {
        const r = run(3, supply({ location: base, kind: 'BALING_REQUEST' }), demand({ location: north(base, km) }));
        expect(r.excluded).not.toContain('OVER_MAX_TRANSPORT');
        expect(r.excluded).not.toContain('OVER_RADIUS');
      }),
      RUNS,
    );
  });

  it('buyer radius (routes 1, 2, 4): OVER_RADIUS iff distance exceeds radius; equal passes', () => {
    fc.assert(
      fc.property(
        baseArb,
        fc.double({ min: 0, max: 120, noNaN: true }),
        fc.double({ min: 0, max: 120, noNaN: true }),
        capRoute,
        (base, km, radius, route) => {
          const s = supply({ location: base });
          const d = demand({ location: north(base, km), radiusKm: radius });
          const r = run(route, s, d);
          expect(r.excluded.includes('OVER_RADIUS')).toBe((r.distanceExactKm as number) > radius);
          const same = run(route, s, demand({ location: north(base, km), radiusKm: r.distanceExactKm }));
          expect(same.excluded).not.toContain('OVER_RADIUS');
        },
      ),
      RUNS,
    );
  });

  it('route 3 service area: AREA_MISMATCH iff distance exceeds the service radius', () => {
    fc.assert(
      fc.property(
        baseArb,
        fc.double({ min: 0, max: 300, noNaN: true }),
        fc.double({ min: 0, max: 300, noNaN: true }),
        (base, km, radius) => {
          const r = run(
            3,
            supply({ location: base, kind: 'BALING_REQUEST' }),
            demand({ location: north(base, km), radiusKm: radius }),
          );
          expect(r.excluded.includes('AREA_MISMATCH')).toBe((r.distanceExactKm as number) > radius);
        },
      ),
      RUNS,
    );
  });

  it('SAME_ORG is reported iff both sides share an org id', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 4 }), fc.string({ minLength: 1, maxLength: 4 }), anyRoute, (a, b, route) => {
        const r = run(route, supply({ orgId: a }), demand({ orgId: b }));
        expect(r.excluded.includes('SAME_ORG')).toBe(a === b);
      }),
      RUNS,
    );
  });

  it('OTHER material is always excluded, even when both sides are OTHER', () => {
    fc.assert(
      fc.property(fc.constantFrom(...MATERIALS), fc.constantFrom(...MATERIALS), anyRoute, (ms, md, route) => {
        const r = run(route, supply({ material: ms }), demand({ material: md }));
        const mismatch = ms === 'OTHER' || md === 'OTHER' || ms !== md;
        expect(r.excluded.includes('MATERIAL_MISMATCH')).toBe(mismatch);
        if (ms === 'OTHER' || md === 'OTHER') expect(r.excluded).toContain('MATERIAL_MISMATCH');
      }),
      RUNS,
    );
  });

  it('exclusion codes are complete against an independent oracle and always in fixed order', () => {
    const supplyArb = fc.record({
      published: fc.boolean(),
      orgId: fc.constantFrom('a', 'b'),
      material: fc.constantFrom(...MATERIALS),
      kg: fc.integer({ min: -5, max: 5000 }),
      from: fc.integer({ min: 1, max: 20 }),
      len: fc.integer({ min: 0, max: 10 }),
      km: fc.double({ min: 0, max: 200, noNaN: true }),
    });
    const demandArb = fc.record({
      published: fc.boolean(),
      orgId: fc.constantFrom('a', 'b'),
      material: fc.constantFrom(...MATERIALS),
      kg: fc.integer({ min: -5, max: 5000 }),
      minLot: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null }),
      from: fc.integer({ min: 1, max: 20 }),
      len: fc.integer({ min: 0, max: 10 }),
      radius: fc.option(fc.double({ min: 0, max: 200, noNaN: true }), { nil: null }),
    });
    fc.assert(
      fc.property(supplyArb, demandArb, capRoute, (sa, da, route) => {
        const base = { lat: 16, lng: 100 };
        const s = supply({
          published: sa.published, orgId: sa.orgId, material: sa.material, remainingKg: new Decimal(sa.kg),
          window: { from: day(sa.from), to: day(sa.from + sa.len) }, location: base,
        });
        const d = demand({
          published: da.published, orgId: da.orgId, material: da.material, remainingKg: new Decimal(da.kg),
          minLotKg: da.minLot === null ? null : new Decimal(da.minLot),
          window: { from: day(da.from), to: day(da.from + da.len) }, radiusKm: da.radius,
          location: north(base, sa.km),
        });
        const r = run(route, s, d);
        const exact = r.distanceExactKm as number;
        const expected = new Set<string>();
        if (!sa.published || !da.published) expected.add('NOT_PUBLISHED');
        if (sa.kg <= 0 || da.kg <= 0) expected.add('NO_REMAINING');
        if (sa.orgId === da.orgId) expected.add('SAME_ORG');
        if (sa.material === 'OTHER' || da.material === 'OTHER' || sa.material !== da.material) expected.add('MATERIAL_MISMATCH');
        if (da.minLot !== null && sa.kg < da.minLot) expected.add('BELOW_MIN_LOT');
        if (sa.from <= da.from + da.len && da.from <= sa.from + sa.len) {
          // overlap
        } else expected.add('WINDOW_NO_OVERLAP');
        if (da.radius !== null && exact > da.radius) expected.add('OVER_RADIUS');
        if (exact > 80) expected.add('OVER_MAX_TRANSPORT');

        expect(new Set(r.excluded)).toEqual(expected);
        expect(new Set(r.excluded).size).toBe(r.excluded.length);
        const idx = r.excluded.map((c) => EXCLUSION_CODES.indexOf(c));
        expect(idx).toEqual([...idx].sort((x, y) => x - y));
        expect(r).toEqual(run(route, s, d));
      }),
      RUNS,
    );
  });
});
