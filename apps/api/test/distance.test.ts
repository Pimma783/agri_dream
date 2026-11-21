import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { EARTH_RADIUS_KM, haversineKm, type Coordinates } from '../src/domain/distance.js';

const coord = fc.record({
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

describe('haversineKm', () => {
  // Feature: agrimatch-mvp, Property 2: Haversine distance is a metric-like function
  // **Validates: Requirements 9.7**
  it('is non-negative, symmetric and zero on identical points', () => {
    fc.assert(
      fc.property(coord, coord, (a, b) => {
        expect(haversineKm(a, b)).toBeGreaterThanOrEqual(0);
        expect(haversineKm(a, b)).toBe(haversineKm(b, a));
        expect(haversineKm(a, a)).toBe(0);
      }),
    );
  });

  it('satisfies the triangle inequality within tolerance', () => {
    fc.assert(
      fc.property(coord, coord, coord, (a, b, c) => {
        // Haversine loses precision near antipodal points (about 1e-5 km at
        // 20,000 km), so the tolerance scales with the distances involved.
        const sum = haversineKm(a, b) + haversineKm(b, c);
        expect(haversineKm(a, c)).toBeLessThanOrEqual(sum + 1e-6 + sum * 1e-9);
      }),
    );
  });

  it('matches known values', () => {
    // One degree of latitude on the mean-radius sphere.
    const oneDeg = (Math.PI / 180) * EARTH_RADIUS_KM;
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(oneDeg, 6);
    // Antipodes: half the circumference.
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 6);
    // Uttaradit city to Phitsanulok city is roughly 90 km in a straight line.
    const d = haversineKm({ lat: 17.6200, lng: 100.0993 }, { lat: 16.8211, lng: 100.2659 });
    expect(d).toBeGreaterThan(85);
    expect(d).toBeLessThan(95);
  });

  it('rejects out-of-range or non-finite coordinates', () => {
    const ok: Coordinates = { lat: 0, lng: 0 };
    expect(() => haversineKm(ok, { lat: 91, lng: 0 })).toThrow(RangeError);
    expect(() => haversineKm(ok, { lat: 0, lng: Number.NaN })).toThrow(RangeError);
  });
});
