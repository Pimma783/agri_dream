// Visibility mapper for GET /matches: allowlist output, never contact or identity (Req 9.10, 14.9, 17.5).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BalingRequest, BalingService, Demand, Listing } from '../src/repos/index.js';
import { type CounterpartySource, toMatchView, type MatchRowForView } from '../src/services/matches/visibility.js';

const ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ORG = '22222222-2222-4222-8222-222222222222';
const T = new Date('2026-11-18T00:00:00Z');

const matchRow = (over: Partial<MatchRowForView> = {}): MatchRowForView => ({
  id: ID, route: 1, supply_id: '33333333-3333-4333-8333-333333333333', demand_id: '44444444-4444-4444-8444-444444444444',
  rule_version: 'rules-test.1', score: '72.50', weight_coverage: '0.8000',
  components: { distance: { value: '0.9000', weight: '0.3000' }, price: { value: null, weight: '0.2000' } },
  flags: [{ code: 'NEEDS_CONFIRMATION', field: 'moisture' }, { code: 'INCOMPLETE' }],
  reasons: [{ code: 'DISTANCE_KM', params: { km: '12.30' } }, { code: 'MISSING_PRICE', params: { component: 'price' } }],
  distance_km: '12.30', tier: 1, is_demo: true, computed_at: T, ...over,
});

const listing = (over: Partial<Listing> = {}): Listing => ({
  id: ID, org_id: OWNER_ORG, kind: 'SALE', material_type: 'RICE_STRAW', material_form: 'LOOSE', total_qty_kg: '5000',
  committed_qty_kg: '0', remaining_qty_kg: '5000', price_mode: 'FIXED', unit_price_thb: '1.5000', price_unit: 'KG',
  province: 'Uttaradit', district: 'Secret District', lat: '17.123456', lng: '100.654321', available_from: T, available_to: T,
  transport_by: 'EITHER', pending_material: false, expected_ready_at: null, source_agreement_id: null, source_draft_id: null,
  status: 'PUBLISHED', version: 1, is_demo: true, created_at: T, updated_at: T, ...over,
});

describe('toMatchView', () => {
  it('renders Thai reasons and flags, straight-line distance, rule version and the demo labels', () => {
    const v = toMatchView(matchRow(), 'demand', { type: 'LISTING', row: listing(), org: { kind: 'FARMER', name: 'Somchai Farmer' } });
    expect(v).toMatchObject({
      own_side: 'demand', own_entity_id: '44444444-4444-4444-8444-444444444444', tier: 1, score: '72.50',
      score_label_th: 'ประมาณการ', weights_label_th: 'น้ำหนักคะแนนเริ่มต้น', rule_version: 'rules-test.1', weight_coverage: '0.8000',
      missing_components: ['price'],
    });
    expect(v.distance).toMatchObject({ km: '12.30', kind: 'straight_line' });
    expect(v.distance?.label_th).toContain('ไม่ใช่ระยะขับรถ');
    expect(v.reasons[0]?.text_th).toContain('12.30');
    expect(v.flags.map((f) => f.code)).toEqual(['NEEDS_CONFIRMATION', 'INCOMPLETE']);
    expect(v.flags[1]?.label_th).toBe('ข้อมูลไม่ครบ');
  });

  it('hides a farmer counterparty identity, exact location and owner id', () => {
    const v = toMatchView(matchRow(), 'demand', { type: 'LISTING', row: listing(), org: { kind: 'FARMER', name: 'Somchai Farmer' } });
    const text = JSON.stringify(v);
    expect(v.counterparty.display_name).toBeNull();
    expect(v.counterparty.province).toBe('Uttaradit');
    for (const secret of ['Somchai', 'Secret District', '17.123456', '100.654321', OWNER_ORG]) expect(text).not.toContain(secret);
  });

  it('shows a factory business name', () => {
    const v = toMatchView(matchRow(), 'supply', { type: 'LISTING', row: listing(), org: { kind: 'BUYER_FACTORY', name: 'Synthetic Plant' } });
    expect(v.counterparty.display_name).toBe('Synthetic Plant');
  });

  it('tolerates malformed stored json without throwing', () => {
    const v = toMatchView(matchRow({ components: 'x', flags: 7, reasons: null }), 'supply', {
      type: 'LISTING', row: listing(), org: { kind: 'BALER', name: 'b' },
    });
    expect(v.components).toEqual({});
    expect(v.flags).toEqual([]);
    expect(v.reasons).toEqual([]);
  });
});

describe('toMatchView never leaks contact or identity (property)', () => {
  const token = fc.stringMatching(/^[a-z0-9]{12}$/).map((s) => `leak${s}`);
  const decimal = fc.integer({ min: 1, max: 99999 }).map((n) => `${n}.123457`);

  const sources = fc
    .record({
      orgId: fc.uuid(), name: token, contact: token, lineId: token, district: token, lat: decimal, lng: decimal,
      kind: fc.constantFrom('FARMER', 'BALER', 'BUYER_FACTORY'), type: fc.constantFrom('LISTING', 'DEMAND', 'BALING_REQUEST', 'BALING_SERVICE'),
      province: fc.option(fc.constantFrom('Uttaradit', 'Nakhon Sawan', 'Kamphaeng Phet'), { nil: null }),
    })
    .map((g) => {
      const secrets = { org_id: g.orgId, district: g.district, lat: g.lat, lng: g.lng, province: g.province };
      const extras = { phone: g.contact, line_user_id: g.lineId, email: `${g.contact}@x.invalid`, owner_name: g.name };
      const base = listing({ ...secrets });
      let src: CounterpartySource;
      switch (g.type) {
        case 'LISTING': src = { type: 'LISTING', row: { ...base, ...extras } as Listing, org: { kind: g.kind, name: g.name } }; break;
        case 'DEMAND':
          src = { type: 'DEMAND', row: { ...base, ...extras, accepted_materials: ['RICE_STRAW'], accepted_forms: [], accepted_provinces: ['Uttaradit'], target_qty_kg: '1', min_lot_kg: null, max_unit_price_thb: null, radius_km: null, window_from: null, window_to: null, quality: {}, accepts_pending_material: false } as unknown as Demand, org: { kind: g.kind, name: g.name } };
          break;
        case 'BALING_REQUEST':
          src = { type: 'BALING_REQUEST', row: { ...base, ...extras, qty_kg: '100', requested_mode: 'ON_SITE', needed_from: null, needed_to: null } as unknown as BalingRequest, org: { kind: g.kind, name: g.name } };
          break;
        default:
          src = { type: 'BALING_SERVICE', row: { ...base, ...extras, material_types: ['RICE_STRAW'], baling_format: null, service_mode: 'BOTH', service_provinces: [], min_qty_kg: null, capacity_kg: null } as unknown as BalingService, org: { kind: g.kind, name: g.name } };
      }
      return { src, g };
    });

  it('output contains no contact fields, owner ids, coordinates or district, and no farmer name', () => {
    fc.assert(
      fc.property(sources, fc.constantFrom('supply', 'demand'), ({ src, g }, side) => {
        const text = JSON.stringify(toMatchView(matchRow(), side, src));
        for (const secret of [g.orgId, g.district, g.lat, g.lng, g.contact, g.lineId, `${g.contact}@x.invalid`]) {
          expect(text).not.toContain(secret);
        }
        if (g.kind === 'FARMER') expect(text).not.toContain(g.name);
        else expect(text).toContain(g.name);
        expect(text).not.toMatch(/"(phone|line_user_id|email|owner_name|org_id|lat|lng|district)"/);
      }),
      { numRuns: 200 },
    );
  });
});
