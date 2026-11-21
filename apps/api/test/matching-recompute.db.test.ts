import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RULES_V1 } from '../src/matching/rules/v1.js';
import { balingRequests, balingServices, listings, demands } from '../src/repos/index.js';
import { createMatchingService, type MatchingService } from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOffer, makeOrg } from './factories.js';
import { agreements } from '../src/repos/index.js';

const NEAR = { lat: '17.620000', lng: '100.100000' };
const NEAR_B = { lat: '17.720000', lng: '100.100000' }; // about 11 km away
const FAR_B = { lat: '15.700000', lng: '100.140000' }; // about 215 km away

describe.skipIf(!testDatabaseUrl)('recompute_matches (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let svc: MatchingService;
  const NOW = new Date('2026-11-18T00:00:00Z');

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    svc = createMatchingService({ pool, now: () => NOW });
  });
  afterAll(async () => {
    await db?.close();
  });

  const run = async (entity_type: string, entity_id: string, version = 1) => {
    const r = await svc.recompute({ entity_type, entity_id, version });
    if (!r.ok) throw new Error(`recompute failed ${r.error.code}`);
    return r.value;
  };
  const rows = async (col: 'supply_id' | 'demand_id', id: string) =>
    (await pool.query(`SELECT * FROM matches WHERE ${col} = $1 ORDER BY route, supply_id, demand_id`, [id])).rows;
  const snapshot = async (id: string) =>
    (await pool.query('SELECT id, route, supply_id, demand_id, rule_version, score, weight_coverage, components, flags, reasons, distance_km, supply_version, demand_version, tier FROM matches WHERE supply_id=$1 OR demand_id=$1 ORDER BY id', [id])).rows;

  it('route 1: SALE listing x factory demand is stored with score, components, coverage, distance and versions', async () => {
    const farmer = await makeOrg(pool, 'FARMER');
    const factory = await makeOrg(pool, 'BUYER_FACTORY');
    const l = await makeListing(pool, farmer.id, { ...NEAR, material_form: 'LOOSE', available_from: new Date('2026-11-20'), available_to: new Date('2026-12-20') });
    const d = await makeDemand(pool, factory.id, { ...NEAR_B, accepted_forms: ['LOOSE'], window_from: new Date('2026-11-25'), window_to: new Date('2026-12-30') });
    await run('LISTING', l.id);
    const [m] = await rows('supply_id', l.id);
    expect(m).toMatchObject({ route: 1, demand_id: d.id, rule_version: RULES_V1.version, supply_version: l.version, demand_version: d.version });
    expect(Number(m.distance_km)).toBeGreaterThan(5);
    expect(Number(m.distance_km)).toBeLessThan(20);
    expect(Number(m.score)).toBeGreaterThan(0);
    expect(m.components.distance.value).not.toBeNull();
    expect(m.reasons.length).toBeGreaterThan(0);
    // the demand-side trigger finds the same pair
    await run('DEMAND', d.id);
    expect((await rows('demand_id', d.id)).filter((r) => r.supply_id === l.id)).toHaveLength(1);
  });

  it('route 2: SALE listing x BALER purchase demand', async () => {
    const farmer = await makeOrg(pool, 'FARMER');
    const baler = await makeOrg(pool, 'BALER');
    const l = await makeListing(pool, farmer.id, NEAR);
    const d = await makeDemand(pool, baler.id, NEAR_B);
    await run('DEMAND', d.id);
    expect((await rows('demand_id', d.id)).map((r) => [r.route, r.supply_id])).toContainEqual([2, l.id]);
  });

  it('route 4: RESALE listing x factory demand; a baler demand never matches a RESALE listing', async () => {
    const baler = await makeOrg(pool, 'BALER');
    const factory = await makeOrg(pool, 'BUYER_FACTORY');
    const otherBaler = await makeOrg(pool, 'BALER');
    // a RESALE listing needs a source agreement (farmer sells to the baler)
    const farmer = await makeOrg(pool, 'FARMER');
    const src = await makeListing(pool, farmer.id, NEAR);
    const srcDemand = await makeDemand(pool, baler.id, NEAR_B);
    const offer = await makeOffer(pool, { listing: src, demand: srcDemand });
    const agreement = await agreements.insertIfAbsent(pool, {
      kind: 'PURCHASE', offer_id: offer.id, seller_org_id: farmer.id, buyer_org_id: baler.id, listing_id: src.id,
      demand_id: srcDemand.id, qty_kg: '1000.000', status: 'PURCHASE_CONFIRMED',
    });
    const l = await makeListing(pool, baler.id, { ...NEAR, kind: 'RESALE', source_agreement_id: agreement!.id });
    const d = await makeDemand(pool, factory.id, NEAR_B);
    const bd = await makeDemand(pool, otherBaler.id, NEAR_B);
    await run('LISTING', l.id);
    const got = await rows('supply_id', l.id);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((r) => r.route === 4)).toBe(true);
    expect(got.some((r) => r.demand_id === d.id)).toBe(true);
    expect(got.some((r) => r.demand_id === bd.id)).toBe(false);
  });

  it('route 3: baling request x baling service, with service-area weights', async () => {
    const farmer = await makeOrg(pool, 'FARMER');
    const baler = await makeOrg(pool, 'BALER');
    const req = await balingRequests.insert(pool, {
      org_id: farmer.id, material_type: 'RICE_STRAW', qty_kg: '8000.000', requested_mode: 'ON_SITE', status: 'PUBLISHED',
      province: 'Uttaradit', ...NEAR,
    });
    const srv = await balingServices.insert(pool, {
      org_id: baler.id, material_types: ['RICE_STRAW'], service_mode: 'BOTH', price_mode: 'NEGOTIABLE', status: 'PUBLISHED',
      service_provinces: ['Uttaradit'], capacity_kg: '20000.000',
    });
    await run('BALING_REQUEST', req.id);
    const [m] = await rows('supply_id', req.id);
    expect(m).toMatchObject({ route: 3, demand_id: srv.id });
    expect(m.components.serviceArea.value).toBe('1.0000');
    await run('BALING_SERVICE', srv.id);
    expect((await rows('demand_id', srv.id)).filter((r) => r.supply_id === req.id)).toHaveLength(1);
  });

  it('excludes pairs beyond the 80 km cap', async () => {
    const farmer = await makeOrg(pool, 'FARMER');
    const factory = await makeOrg(pool, 'BUYER_FACTORY');
    const l = await makeListing(pool, farmer.id, NEAR);
    const far = await makeDemand(pool, factory.id, FAR_B);
    await run('LISTING', l.id);
    expect((await rows('supply_id', l.id)).some((r) => r.demand_id === far.id)).toBe(false);
  });

  it('excludes same-organization pairs and unconfirmed OTHER material', async () => {
    const org = await makeOrg(pool, 'BUYER_FACTORY');
    const farmer = await makeOrg(pool, 'FARMER');
    const factory = await makeOrg(pool, 'BUYER_FACTORY');
    const own = await makeListing(pool, org.id, NEAR);
    await makeDemand(pool, org.id, NEAR_B);
    const other = await makeListing(pool, farmer.id, { ...NEAR, material_type: 'OTHER' });
    await makeDemand(pool, factory.id, { ...NEAR_B, accepted_materials: ['OTHER', 'RICE_STRAW'] });
    await run('LISTING', own.id);
    await run('LISTING', other.id);
    const mine = await rows('supply_id', own.id);
    expect(mine.every((r) => (r.demand_id as string) !== '')).toBe(true);
    const sameOrgDemand = (await pool.query('SELECT id FROM purchase_demands WHERE org_id = $1', [org.id])).rows[0].id;
    expect(mine.some((r) => r.demand_id === sameOrgDemand)).toBe(false);
    expect(await rows('supply_id', other.id)).toEqual([]);
  });

  it('missing coordinates keep the pair with DISTANCE_UNVERIFIED and INCOMPLETE at tier 1', async () => {
    const farmer = await makeOrg(pool, 'FARMER');
    const factory = await makeOrg(pool, 'BUYER_FACTORY');
    const l = await makeListing(pool, farmer.id);
    const d = await makeDemand(pool, factory.id);
    await run('LISTING', l.id);
    const m = (await rows('supply_id', l.id)).find((r) => r.demand_id === d.id);
    expect(m).toBeDefined();
    expect(m!.distance_km).toBeNull();
    expect(m!.tier).toBe(1);
    const codes = (m!.flags as { code: string }[]).map((f) => f.code);
    expect(codes).toContain('DISTANCE_UNVERIFIED');
    expect(codes).toContain('INCOMPLETE');
    expect(Number(m!.weight_coverage)).toBeLessThan(1);
  });

  it('is idempotent: running twice, from either side, yields identical rows', async () => {
    const farmer = await makeOrg(pool, 'FARMER');
    const factory = await makeOrg(pool, 'BUYER_FACTORY');
    const l = await makeListing(pool, farmer.id, NEAR);
    await makeDemand(pool, factory.id, NEAR_B);
    await run('LISTING', l.id);
    const first = await snapshot(l.id);
    expect(first.length).toBeGreaterThan(0);
    await run('LISTING', l.id);
    expect(await snapshot(l.id)).toEqual(first);
    const dId = first[0].demand_id as string;
    await run('DEMAND', dId);
    await run('DEMAND', dId);
    expect(await snapshot(l.id)).toEqual(first);
  });

  it('removes matches when a counterparty changes so it no longer passes, and when the entity closes', async () => {
    const farmer = await makeOrg(pool, 'FARMER');
    const factory = await makeOrg(pool, 'BUYER_FACTORY');
    const l = await makeListing(pool, farmer.id, NEAR);
    const d = await makeDemand(pool, factory.id, NEAR_B);
    await run('LISTING', l.id);
    expect((await rows('supply_id', l.id)).some((r) => r.demand_id === d.id)).toBe(true);
    // demand moves out of reach: recompute from the demand side drops the pair
    await demands.update(pool, d.id, { lat: FAR_B.lat, lng: FAR_B.lng });
    await run('DEMAND', d.id, 2);
    expect((await rows('supply_id', l.id)).some((r) => r.demand_id === d.id)).toBe(false);
    // back in reach, then the listing closes
    await demands.update(pool, d.id, { lat: NEAR_B.lat, lng: NEAR_B.lng });
    await run('LISTING', l.id, 2);
    expect((await rows('supply_id', l.id)).some((r) => r.demand_id === d.id)).toBe(true);
    await listings.update(pool, l.id, { status: 'CLOSED' });
    const out = await run('LISTING', l.id, 3);
    expect(out.removed).toBeGreaterThan(0);
    expect(await rows('supply_id', l.id)).toEqual([]);
    // closing the demand removes its rows too
    const l2 = await makeListing(pool, farmer.id, NEAR);
    await run('DEMAND', d.id, 4);
    expect((await rows('demand_id', d.id)).some((r) => r.supply_id === l2.id)).toBe(true);
    await demands.update(pool, d.id, { status: 'PAUSED' });
    await run('DEMAND', d.id, 5);
    expect(await rows('demand_id', d.id)).toEqual([]);
  });

  it('rejects a malformed payload without touching matches', async () => {
    const r = await svc.recompute({ entity_type: 'NOPE', entity_id: 'x', version: 1 });
    expect(r.ok).toBe(false);
  });
});
