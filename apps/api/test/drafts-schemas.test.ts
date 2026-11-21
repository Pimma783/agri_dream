import { describe, expect, it } from 'vitest';
import { serviceRegistry } from '../src/domain/permissions.js';
import {
  completeness, consistencyIssues, mergeData, normalizePatch,
} from '../src/services/drafts/schemas.js';
import '../src/services/index.js';

const ok = (kind: Parameters<typeof normalizePatch>[0], raw: unknown) => {
  const r = normalizePatch(kind, raw);
  if (!r.ok) throw new Error(`unexpected: ${JSON.stringify(r.issues)}`);
  return r.fields;
};

describe('draft patch normalization', () => {
  it('converts ton to kg strings and price to canonical decimals', () => {
    const f = ok('SALE_LISTING', { quantity: { value: '2.5', unit: 'ton' }, price: { value: '1.5', unit: 'kg' } });
    expect(f).toEqual({ qty_kg: '2500.000', unit_price_thb: '1.5000', price_unit: 'KG' });
  });

  it.each(['เกวียน', 'ไร่', 'bale'])('asks for confirmation instead of converting %s', (unit) => {
    const r = normalizePatch('SALE_LISTING', { quantity: { value: '3', unit } });
    expect(r).toEqual({ ok: false, issues: [{ path: 'quantity', message: 'UNIT_NEEDS_CONFIRMATION' }] });
  });

  it('refuses numbers as quantity values and negative values', () => {
    expect(normalizePatch('SALE_LISTING', { quantity: { value: 5, unit: 'kg' } }).ok).toBe(false);
    expect(normalizePatch('SALE_LISTING', { quantity: { value: '-5', unit: 'kg' } }).ok).toBe(false);
  });

  it.each(['status', 'version', 'org_id', 'published_entity_id', 'source_agreement_id', 'qty_kg'])(
    'rejects the non-whitelisted key %s',
    (key) => {
      expect(normalizePatch('SALE_LISTING', { [key]: 'x' }).ok).toBe(false);
    },
  );

  it('rejects a key of another draft kind', () => {
    expect(normalizePatch('BALING_REQUEST', { target_quantity: { value: '1', unit: 'kg' } }).ok).toBe(false);
  });

  it('keeps coordinates only when given and normalizes them to 6 places', () => {
    const f = ok('SALE_LISTING', { lat: 17.62, lng: '100.0993' });
    expect(f).toEqual({ lat: '17.620000', lng: '100.099300' });
    expect(ok('SALE_LISTING', { province: 'Uttaradit' })).not.toHaveProperty('lat');
  });

  it('rejects invalid dates', () => {
    expect(normalizePatch('SALE_LISTING', { available_from: 'next week' }).ok).toBe(false);
  });
});

describe('draft consistency and completeness', () => {
  const sale = { material_type: 'RICE_STRAW', qty_kg: '5000.000', price_mode: 'FIXED', unit_price_thb: '1.2000', price_unit: 'KG', province: 'Uttaradit' };

  it('is complete with the required fields and no coordinates', () => {
    expect(completeness('SALE_LISTING', sale)).toEqual({ complete: true, missing: [] });
  });

  it('lists missing fields', () => {
    expect(completeness('SALE_LISTING', {}).missing.sort()).toEqual(['material_type', 'price_mode', 'province', 'qty_kg']);
  });

  it('FIXED needs a price; NEGOTIABLE needs none and must not carry one', () => {
    const { unit_price_thb: _p, price_unit: _u, ...noPrice } = sale;
    expect(completeness('SALE_LISTING', noPrice).missing).toContain('price');
    expect(completeness('SALE_LISTING', { ...noPrice, price_mode: 'NEGOTIABLE' }).complete).toBe(true);
    expect(consistencyIssues('SALE_LISTING', { ...sale, price_mode: 'NEGOTIABLE' })).toEqual([{ path: 'price', message: 'NEGOTIABLE_HAS_NO_PRICE' }]);
  });

  it('switching to NEGOTIABLE drops the stored price', () => {
    const merged = mergeData('SALE_LISTING', sale, { price_mode: 'NEGOTIABLE' });
    expect(merged).not.toHaveProperty('unit_price_thb');
    expect(merged).not.toHaveProperty('price_unit');
  });

  it('requires lat and lng together and an ordered window', () => {
    expect(consistencyIssues('SALE_LISTING', { lat: '17.000000' })).toEqual([{ path: 'lat', message: 'LAT_LNG_TOGETHER' }]);
    expect(consistencyIssues('SALE_LISTING', { available_from: '2026-12-02T00:00:00.000Z', available_to: '2026-12-01T00:00:00.000Z' })).toEqual([
      { path: 'available_to', message: 'BEFORE_START' },
    ]);
  });

  it('a resale draft that is pending needs expected_ready_at', () => {
    const resale = { ...sale, pending_material: true };
    expect(completeness('RESALE_LISTING', resale).missing).toEqual(['expected_ready_at']);
    expect(completeness('RESALE_LISTING', { ...resale, expected_ready_at: '2026-12-10T00:00:00.000Z' }).complete).toBe(true);
    expect(completeness('RESALE_LISTING', sale).missing).toEqual(['pending_material']);
  });

  it('demand needs materials, target, price mode and a place; min lot cannot exceed target', () => {
    const demand = { accepted_materials: ['RICE_STRAW'], target_qty_kg: '50000.000', price_mode: 'NEGOTIABLE', province: 'Nakhon Sawan' };
    expect(completeness('PURCHASE_DEMAND', demand).complete).toBe(true);
    expect(completeness('PURCHASE_DEMAND', { ...demand, min_lot_kg: '60000.000' }).complete).toBe(false);
  });

  it('baling service and request required fields', () => {
    expect(completeness('BALING_SERVICE', { material_types: ['RICE_STRAW'], service_mode: 'BOTH', price_mode: 'FIXED', unit_price_thb: '80.0000', price_unit: 'BALE', province: 'Kamphaeng Phet' }).complete).toBe(true);
    expect(completeness('BALING_REQUEST', { material_type: 'RICE_STRAW', qty_kg: '3000.000', requested_mode: 'ON_SITE', province: 'Uttaradit' }).complete).toBe(true);
    expect(completeness('BALING_REQUEST', {}).missing.sort()).toEqual(['material_type', 'province', 'qty_kg', 'requested_mode']);
  });
});

describe('service registration', () => {
  it('registers every draft and entity service with a declared capability', () => {
    const names = [...serviceRegistry.entries().keys()];
    for (const n of [
      'drafts.sale_listing', 'drafts.resale_listing', 'drafts.purchase_demand', 'drafts.baling_service', 'drafts.baling_request',
      'listings', 'demands', 'baling_services', 'baling_requests',
    ]) expect(names).toContain(n);
    expect(serviceRegistry.undeclared()).toEqual([]);
  });
});
