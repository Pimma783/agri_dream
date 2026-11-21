import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeOfferTotal } from '../src/domain/offer-terms.js';
import { serviceRegistry } from '../src/domain/permissions.js';
import { createOfferService, offerText } from '../src/services/index.js';
import { CreateOfferSchema, EditOfferSchema } from '../src/services/offers/schemas.js';
import type { Offer } from '../src/repos/index.js';

describe('computeOfferTotal', () => {
  it('multiplies kg by a per-kg price and by a per-ton price over tons', () => {
    expect(computeOfferTotal('1000.000', '1.5000', 'KG')).toBe('1500.00');
    expect(computeOfferTotal('2500.000', '800.0000', 'TON')).toBe('2000.00');
  });
  it('rounds half up to 2 places', () => {
    expect(computeOfferTotal('1.000', '0.0050', 'KG')).toBe('0.01');
    expect(computeOfferTotal('3.000', '0.1250', 'KG')).toBe('0.38');
  });
  it('is null without a price, a unit, or with a per-bale price', () => {
    expect(computeOfferTotal('10.000', null, null)).toBeNull();
    expect(computeOfferTotal('10.000', '5.0000', null)).toBeNull();
    expect(computeOfferTotal('10.000', '5.0000', 'BALE')).toBeNull();
  });
  it('property: equals qty x price for KG and ignores any transport (not a parameter)', () => {
    // Feature: agrimatch-mvp, Property 11: total is qty x price, independent of transport
    // **Validates: Requirements 11.1, 11.2**
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 0, max: 99_999 }), (qtyMilli, priceTenK) => {
        const qty = (qtyMilli / 1000).toFixed(3);
        const price = (priceTenK / 10_000).toFixed(4);
        // Exact integer oracle: qty (1e-3 kg) x price (1e-4 THB) is in 1e-7 THB; cents = round half up of /1e5.
        const cents = (BigInt(qtyMilli) * BigInt(priceTenK) + 50_000n) / 100_000n;
        const expected = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
        expect(computeOfferTotal(qty, price, 'KG')).toBe(expected);
      }),
    );
  });
});

describe('offer input schemas', () => {
  const base = { kind: 'PURCHASE', listingId: crypto.randomUUID(), demandId: crypto.randomUUID(), qtyKg: '100' } as const;
  it('accepts a minimal offer and rejects numbers, unknown keys and half a price', () => {
    expect(CreateOfferSchema.safeParse(base).success).toBe(true);
    expect(CreateOfferSchema.safeParse({ ...base, qtyKg: 100 }).success).toBe(false);
    expect(CreateOfferSchema.safeParse({ ...base, orgId: 'x' }).success).toBe(false);
    expect(CreateOfferSchema.safeParse({ ...base, unitPriceThb: '1.5' }).success).toBe(false);
    expect(CreateOfferSchema.safeParse({ ...base, unitPriceThb: '1.5', priceUnit: 'KG' }).success).toBe(true);
    expect(CreateOfferSchema.safeParse({ ...base, qtyKg: '0' }).success).toBe(false);
  });
  it('edit needs at least one change and a price pair', () => {
    const id = crypto.randomUUID();
    expect(EditOfferSchema.safeParse({ offerId: id, expectedVersion: 1, changes: {} }).success).toBe(false);
    expect(EditOfferSchema.safeParse({ offerId: id, expectedVersion: 1, changes: { unitPriceThb: '2' } }).success).toBe(false);
    expect(EditOfferSchema.safeParse({ offerId: id, expectedVersion: 1, changes: { qtyKg: '5' } }).success).toBe(true);
  });
});

describe('offer service wiring', () => {
  it('registers its services with declared capabilities', () => {
    createOfferService({ pool: undefined as never });
    const names = [...serviceRegistry.entries().keys()];
    for (const n of ['offers.send', 'offers.read', 'offers.respond', 'offers.withdraw', 'offers.edit']) expect(names).toContain(n);
    expect(serviceRegistry.undeclared()).toEqual([]);
  });
  it('notification text shows transport cost separately and says when it is unknown', () => {
    const o = {
      id: 'x', qty_kg: '100.000', unit_price_thb: '1.5000', price_unit: 'KG', total_amount_thb: '150.00', transport_by: 'SELLER',
      transport_cost_thb: null, ack_pending_material: false, expires_at: new Date('2030-01-01T00:00:00Z'),
    } as unknown as Offer;
    const text = offerText('created', o);
    expect(text).toContain('ยอดรวม: 150.00 บาท (ไม่รวมค่าขนส่ง)');
    expect(text).toContain('ค่าขนส่ง: ยังไม่ทราบ (แยกจากยอดรวม)');
  });
});
