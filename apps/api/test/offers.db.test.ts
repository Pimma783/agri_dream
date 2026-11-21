import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/domain/permissions.js';
import {
  balingRequests, balingServices, lineIdentities, listings, matches, offers, type Offer,
} from '../src/repos/index.js';
import { SweeperSchedule, createExpireOffersSweeper } from '../src/jobs/index.js';
import { createOfferService, type OfferResult, type OfferService, type Result } from '../src/services/index.js';
import { createTestDb, runConcurrently, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOrgWithUser } from './factories.js';

const HOUR = 3600_000;

describe.skipIf(!testDatabaseUrl)('offer service (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let clock = new Date();
  let svc: OfferService;
  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    svc = createOfferService({ pool, now: () => clock });
  });
  afterAll(async () => {
    await db?.close();
  });

  type Party = Awaited<ReturnType<typeof makeOrgWithUser>>;
  const actorOf = (p: Party, role: Actor['role'], channel: Actor['channel'] = 'web'): Actor => ({
    userId: p.user.id, orgId: p.org.id, role, channel,
  });
  const val = <T>(r: Result<T>): T => {
    if (!r.ok) throw new Error(`expected Ok, got ${r.error.code}`);
    return r.value;
  };
  const code = (r: Result<unknown>) => (r.ok ? 'OK' : r.error.code);

  async function link(p: Party, channel: 'farmer' | 'baler' | 'factory') {
    const id = await lineIdentities.ensure(pool, channel, `U-synthetic-${p.org.id}`);
    await lineIdentities.link(pool, id.id, p.user.id, p.org.id);
    return id;
  }

  async function market(over: { listingQty?: string; demandQty?: string } = {}) {
    clock = new Date();
    const farmer = await makeOrgWithUser(pool, 'FARMER');
    const factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    const listing = await makeListing(pool, farmer.org.id, over.listingQty ? { qty: over.listingQty } : {});
    const demand = await makeDemand(pool, factory.org.id, over.demandQty ? { qty: over.demandQty } : {});
    return {
      farmer, factory, listing, demand,
      farmerActor: actorOf(farmer, 'FARMER', 'line:farmer'),
      factoryActor: actorOf(factory, 'BUYER_FACTORY', 'line:factory'),
    };
  }
  const buy = (m: Awaited<ReturnType<typeof market>>, extra: Record<string, unknown> = {}) => ({
    kind: 'PURCHASE' as const, listingId: m.listing.id, demandId: m.demand.id, qtyKg: '1000', unitPriceThb: '1.5', priceUnit: 'KG' as const,
    transportBy: 'BUYER' as const, ...extra,
  });
  const rows = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query<T>(sql, params)).rows;

  describe('create', () => {
    it('stores a PENDING offer with snapshots, total without transport, 72 h expiry, audit and outbox', async () => {
      const m = await market();
      await link(m.farmer, 'farmer');
      const r = val(await svc.create(m.factoryActor, buy(m, { transportCostThb: '120' })));
      const o = r.offer;
      expect(o).toMatchObject({
        kind: 'PURCHASE', status: 'PENDING', from_org_id: m.factory.org.id, to_org_id: m.farmer.org.id,
        listing_id: m.listing.id, demand_id: m.demand.id, listing_version: m.listing.version, demand_version: m.demand.version,
        qty_kg: '1000.000', unit_price_thb: '1.5000', price_unit: 'KG', total_amount_thb: '1500.00',
        transport_by: 'BUYER', transport_cost_thb: '120.00', version: 1,
      });
      expect(o.expires_at.getTime()).toBe(clock.getTime() + 72 * HOUR);
      expect((await rows(`SELECT action, actor_org_id FROM audit_logs WHERE entity_id = $1`, [o.id]))[0]).toMatchObject({ action: 'offer.created', actor_org_id: m.factory.org.id });
      const box = await rows<{ dedupe_key: string; channel: string }>(`SELECT dedupe_key, channel FROM notification_outbox WHERE related_id = $1`, [o.id]);
      expect(box).toHaveLength(1);
      expect(box[0]).toMatchObject({ channel: 'farmer' });
    });

    it('keeps unknown transport cost separate and leaves the total independent of it', async () => {
      const m = await market();
      const a = val(await svc.create(m.factoryActor, buy(m))).offer;
      const b = val(await svc.create(m.factoryActor, buy(m, { transportCostThb: '999' }))).offer;
      expect(a.transport_cost_thb).toBeNull();
      expect(a.total_amount_thb).toBe('1500.00');
      expect(b.total_amount_thb).toBe('1500.00');
    });

    it('has no total for a negotiable offer without price and does not reserve quantity (12.6)', async () => {
      const m = await market();
      const o = val(await svc.create(m.farmerActor, { kind: 'PURCHASE', listingId: m.listing.id, demandId: m.demand.id, qtyKg: '500' })).offer;
      expect(o).toMatchObject({ from_org_id: m.farmer.org.id, to_org_id: m.factory.org.id, unit_price_thb: null, total_amount_thb: null, transport_by: 'UNKNOWN' });
      const l = (await listings.get(pool, m.listing.id))!;
      expect([l.remaining_qty_kg, l.committed_qty_kg]).toEqual([m.listing.remaining_qty_kg, '0.000']);
    });

    it('honours an explicit expiry and refuses one in the past', async () => {
      const m = await market();
      const at = new Date(clock.getTime() + 5 * HOUR).toISOString();
      expect(val(await svc.create(m.factoryActor, buy(m, { expiresAt: at }))).offer.expires_at.toISOString()).toBe(at);
      expect(code(await svc.create(m.factoryActor, buy(m, { expiresAt: new Date(clock.getTime() - HOUR).toISOString() })))).toBe('VALIDATION');
    });

    it('applies the configured default expiry', async () => {
      const m = await market();
      const short = createOfferService({ pool, now: () => clock }, { defaultExpiryHours: 6 });
      expect(val(await short.create(m.factoryActor, buy(m))).offer.expires_at.getTime()).toBe(clock.getTime() + 6 * HOUR);
    });

    it('refuses non-parties (404), the assistant channel (403) and same-org pairs', async () => {
      const m = await market();
      const outsider = await makeOrgWithUser(pool, 'BUYER_FACTORY');
      expect(code(await svc.create(actorOf(outsider, 'BUYER_FACTORY'), buy(m)))).toBe('NOT_FOUND');
      expect(code(await svc.create(actorOf(m.factory, 'BUYER_FACTORY', 'assistant'), buy(m)))).toBe('FORBIDDEN');
      const own = await makeDemand(pool, m.farmer.org.id);
      expect(code(await svc.create(m.farmerActor, { kind: 'PURCHASE', listingId: m.listing.id, demandId: own.id, qtyKg: '10' }))).toBe('VALIDATION');
    });

    it('checks quantity, minimum lot, unit, status and unknown fields', async () => {
      const m = await market({ listingQty: '2000.000' });
      expect(code(await svc.create(m.factoryActor, buy(m, { qtyKg: '2000.001' })))).toBe('INSUFFICIENT_QUANTITY');
      const lot = await makeDemand(pool, m.factory.org.id, { min_lot_kg: '800.000' });
      expect(code(await svc.create(m.factoryActor, { kind: 'PURCHASE', listingId: m.listing.id, demandId: lot.id, qtyKg: '700' }))).toBe('VALIDATION');
      expect(code(await svc.create(m.factoryActor, buy(m, { priceUnit: 'BALE' })))).toBe('VALIDATION');
      expect(code(await svc.create(m.factoryActor, { ...buy(m), extra: 1 } as never))).toBe('VALIDATION');
      await listings.update(pool, m.listing.id, { status: 'PAUSED' });
      expect(code(await svc.create(m.factoryActor, buy(m)))).toBe('INVALID_STATE');
    });

    it('requires ack_pending_material for a pending-material resale listing', async () => {
      const m = await market();
      // The flag is a listing property; a RESALE row would also need a source agreement, which is not under test here.
      const baler = await makeOrgWithUser(pool, 'BALER');
      const resale = await makeListing(pool, baler.org.id, { pending_material: true, expected_ready_at: new Date(clock.getTime() + 24 * HOUR) });
      const input = { kind: 'PURCHASE' as const, listingId: resale.id, demandId: m.demand.id, qtyKg: '100' };
      const f = await svc.create(m.factoryActor, input);
      expect(f.ok).toBe(false);
      if (!f.ok) expect(f.error.fields?.[0]?.path).toBe('ackPendingMaterial');
      const ok = val(await svc.create(m.factoryActor, { ...input, ackPendingMaterial: true })).offer;
      expect(ok.ack_pending_material).toBe(true);
    });

    it('creates from a match and refuses a stale match', async () => {
      const m = await market();
      const match = (await matches.upsert(pool, {
        route: 1, supply_id: m.listing.id, demand_id: m.demand.id, rule_version: 't1', score: '0.800',
        supply_version: m.listing.version, demand_version: m.demand.version, tier: 0,
      }))!;
      const o = val(await svc.create(m.factoryActor, { kind: 'PURCHASE', matchId: match.id, qtyKg: '100' })).offer;
      expect(o).toMatchObject({ listing_id: m.listing.id, demand_id: m.demand.id });
      await listings.update(pool, m.listing.id, { province: 'Changed' });
      expect(code(await svc.create(m.factoryActor, { kind: 'PURCHASE', matchId: match.id, qtyKg: '100' }))).toBe('STALE_VERSION');
      expect(code(await svc.create(m.factoryActor, { kind: 'PURCHASE', matchId: match.id, listingId: m.listing.id, qtyKg: '1' }))).toBe('VALIDATION');
    });

    it('creates BALING_SERVICE offers in both directions with no quantity written', async () => {
      clock = new Date();
      const baler = await makeOrgWithUser(pool, 'BALER');
      const farmer = await makeOrgWithUser(pool, 'FARMER');
      const service = await balingServices.insert(pool, {
        org_id: baler.org.id, material_types: ['RICE_STRAW'], service_mode: 'ON_SITE', price_mode: 'FIXED', unit_price_thb: '0.8000', price_unit: 'KG',
        min_qty_kg: '500.000', status: 'PUBLISHED',
      });
      const request = await balingRequests.insert(pool, {
        org_id: farmer.org.id, material_type: 'RICE_STRAW', qty_kg: '3000.000', requested_mode: 'ON_SITE', status: 'PUBLISHED',
      });
      const fromBaler = val(await svc.create(actorOf(baler, 'BALER'), {
        kind: 'BALING_SERVICE', balingServiceId: service.id, balingRequestId: request.id, qtyKg: '3000', unitPriceThb: '0.8', priceUnit: 'BALE',
      })).offer;
      expect(fromBaler).toMatchObject({
        kind: 'BALING_SERVICE', from_org_id: baler.org.id, to_org_id: farmer.org.id, listing_id: null, demand_id: null,
        listing_version: null, total_amount_thb: null,
      });
      const fromFarmer = val(await svc.create(actorOf(farmer, 'FARMER'), {
        kind: 'BALING_SERVICE', balingServiceId: service.id, balingRequestId: request.id, qtyKg: '1000',
      })).offer;
      expect(fromFarmer).toMatchObject({ from_org_id: farmer.org.id, to_org_id: baler.org.id });
      expect(code(await svc.create(actorOf(farmer, 'FARMER'), { kind: 'BALING_SERVICE', balingServiceId: service.id, balingRequestId: request.id, qtyKg: '100' }))).toBe('VALIDATION');
      expect(code(await svc.create(actorOf(farmer, 'FARMER'), { kind: 'BALING_SERVICE', balingServiceId: service.id, balingRequestId: request.id, qtyKg: '3001' }))).toBe('VALIDATION');
    });
  });

  describe('read access', () => {
    it('shows an offer to sender and receiver only; others get 404; lists are scoped', async () => {
      const m = await market();
      const o = val(await svc.create(m.factoryActor, buy(m))).offer;
      expect(val(await svc.get(m.factoryActor, o.id)).id).toBe(o.id);
      expect(val(await svc.get(m.farmerActor, o.id)).id).toBe(o.id);
      const outsider = await makeOrgWithUser(pool, 'FARMER');
      const out = actorOf(outsider, 'FARMER');
      expect(code(await svc.get(out, o.id))).toBe('NOT_FOUND');
      expect(code(await svc.get(out, crypto.randomUUID()))).toBe('NOT_FOUND');
      expect(code(await svc.get(out, 'not-a-uuid'))).toBe('NOT_FOUND');
      expect(val(await svc.list(out))).toEqual([]);
      expect(val(await svc.list(m.farmerActor, { direction: 'received' })).map((x) => x.id)).toEqual([o.id]);
      expect(val(await svc.list(m.farmerActor, { direction: 'sent' }))).toEqual([]);
      expect(val(await svc.list(m.factoryActor, { status: 'REJECTED' }))).toEqual([]);
    });
  });

  describe('edit = withdraw + create', () => {
    it('leaves one WITHDRAWN and one new PENDING offer with the changed terms', async () => {
      const m = await market();
      await link(m.farmer, 'farmer');
      const o = val(await svc.create(m.factoryActor, buy(m))).offer;
      const r = val(await svc.edit(m.factoryActor, { offerId: o.id, expectedVersion: o.version, changes: { qtyKg: '800', unitPriceThb: '1.8', priceUnit: 'KG' } }));
      expect(r.replaced).toMatchObject({ id: o.id, status: 'WITHDRAWN' });
      expect(r.offer).toMatchObject({ status: 'PENDING', supersedes_offer_id: o.id, qty_kg: '800.000', unit_price_thb: '1.8000', total_amount_thb: '1440.00', transport_by: 'BUYER' });
      const all = await rows<{ status: string }>(`SELECT status FROM offers WHERE from_org_id = $1 ORDER BY created_at, id`, [m.factory.org.id]);
      expect(all.map((x) => x.status).sort()).toEqual(['PENDING', 'WITHDRAWN']);
      expect((await rows(`SELECT 1 FROM notification_outbox WHERE related_id = $1`, [r.offer.id]))).toHaveLength(1);
    });

    it('cannot edit an ACCEPTED offer and reports the state', async () => {
      const m = await market();
      const o = val(await svc.create(m.factoryActor, buy(m))).offer;
      await offers.update(pool, o.id, { status: 'ACCEPTED' });
      const r = await svc.edit(m.factoryActor, { offerId: o.id, expectedVersion: o.version + 1, changes: { qtyKg: '5' } });
      expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_STATE', details: { state: 'ACCEPTED' } } });
    });

    it('rolls back (old stays PENDING) when the new terms are invalid, and checks version and sender', async () => {
      const m = await market({ listingQty: '2000.000' });
      const o = val(await svc.create(m.factoryActor, buy(m))).offer;
      expect(code(await svc.edit(m.factoryActor, { offerId: o.id, expectedVersion: o.version, changes: { qtyKg: '999999' } }))).toBe('INSUFFICIENT_QUANTITY');
      expect((await offers.get(pool, o.id))!.status).toBe('PENDING');
      expect(code(await svc.edit(m.factoryActor, { offerId: o.id, expectedVersion: 99, changes: { qtyKg: '5' } }))).toBe('STALE_VERSION');
      expect(code(await svc.edit(m.farmerActor, { offerId: o.id, expectedVersion: o.version, changes: { qtyKg: '5' } }))).toBe('NOT_FOUND');
      expect((await offers.get(pool, o.id))!.status).toBe('PENDING');
    });
  });

  describe('reject and withdraw', () => {
    it('lets only the receiver reject and notifies the sender; a repeat shows the current state', async () => {
      const m = await market();
      await link(m.factory, 'factory');
      const o = val(await svc.create(m.factoryActor, buy(m))).offer;
      expect(code(await svc.reject(m.factoryActor, { offerId: o.id }))).toBe('NOT_FOUND');
      const r = val(await svc.reject(m.farmerActor, { offerId: o.id, expectedVersion: o.version }));
      expect(r.offer).toMatchObject({ status: 'REJECTED', version: o.version + 1 });
      expect(await rows(`SELECT 1 FROM notification_outbox WHERE related_id = $1`, [o.id])).toHaveLength(1);
      expect(await svc.reject(m.farmerActor, { offerId: o.id })).toMatchObject({ ok: false, error: { code: 'INVALID_STATE', details: { state: 'REJECTED' } } });
      expect(code(await svc.withdraw(m.factoryActor, { offerId: o.id }))).toBe('INVALID_STATE');
    });

    it('lets only the sender withdraw and notifies the receiver', async () => {
      const m = await market();
      await link(m.farmer, 'farmer');
      const o = val(await svc.create(m.factoryActor, buy(m))).offer;
      expect(code(await svc.withdraw(m.farmerActor, { offerId: o.id }))).toBe('NOT_FOUND');
      expect(code(await svc.withdraw(m.factoryActor, { offerId: o.id, expectedVersion: 7 }))).toBe('STALE_VERSION');
      expect(val(await svc.withdraw(m.factoryActor, { offerId: o.id })).offer.status).toBe('WITHDRAWN');
      const kinds = await rows<{ dedupe_key: string }>(`SELECT dedupe_key FROM notification_outbox WHERE related_id = $1 ORDER BY dedupe_key`, [o.id]);
      expect(kinds.map((k) => k.dedupe_key.split(':')[2]).sort()).toEqual(['created', 'withdrawn']);
    });

    it('refuses the assistant channel and unknown ids', async () => {
      const m = await market();
      const o = val(await svc.create(m.factoryActor, buy(m))).offer;
      expect(code(await svc.reject(actorOf(m.farmer, 'FARMER', 'assistant'), { offerId: o.id }))).toBe('FORBIDDEN');
      expect(code(await svc.withdraw(m.factoryActor, { offerId: crypto.randomUUID() }))).toBe('NOT_FOUND');
    });
  });

  describe('expiry', () => {
    it('expires only past-due PENDING offers, once, and notifies both parties', async () => {
      const m = await market();
      await link(m.farmer, 'farmer');
      await link(m.factory, 'factory');
      const soon = val(await svc.create(m.factoryActor, buy(m, { expiresAt: new Date(clock.getTime() + HOUR).toISOString() }))).offer;
      const later = val(await svc.create(m.factoryActor, buy(m))).offer;
      expect(await svc.expireDue(clock)).toBe(0);
      const at = new Date(clock.getTime() + 2 * HOUR);
      expect(await svc.expireDue(at)).toBe(1);
      expect(await svc.expireDue(at)).toBe(0);
      expect((await offers.get(pool, soon.id))!.status).toBe('EXPIRED');
      expect((await offers.get(pool, later.id))!.status).toBe('PENDING');
      expect(await rows(`SELECT 1 FROM notification_outbox WHERE related_id = $1 AND dedupe_key LIKE '%:expired:%'`, [soon.id])).toHaveLength(2);
      expect((await rows(`SELECT channel FROM audit_logs WHERE entity_id = $1 AND action = 'offer.expired'`, [soon.id]))[0]).toMatchObject({ channel: 'system' });
    });

    it('the expire_offers sweeper, run through a SweeperSchedule, turns a past-due PENDING offer into EXPIRED', async () => {
      const m = await market();
      const o = val(await svc.create(m.factoryActor, buy(m, { expiresAt: new Date(clock.getTime() + HOUR).toISOString() }))).offer;
      const keep = val(await svc.create(m.factoryActor, buy(m))).offer;
      const schedule = new SweeperSchedule([createExpireOffersSweeper(svc)], { now: () => new Date(clock.getTime() + 2 * HOUR), random: () => 0 });
      expect(await schedule.tick()).toEqual(['expire_offers']);
      expect((await offers.get(pool, o.id))!.status).toBe('EXPIRED');
      expect((await offers.get(pool, keep.id))!.status).toBe('PENDING');
    });
    it('refuses to reject or withdraw a PENDING offer that is past expiry (OFFER_EXPIRED)', async () => {
      const m = await market();
      const o = val(await svc.create(m.factoryActor, buy(m))).offer;
      clock = new Date(clock.getTime() + 73 * HOUR);
      expect(code(await svc.reject(m.farmerActor, { offerId: o.id }))).toBe('OFFER_EXPIRED');
      expect(code(await svc.withdraw(m.factoryActor, { offerId: o.id }))).toBe('OFFER_EXPIRED');
      expect(code(await svc.edit(m.factoryActor, { offerId: o.id, expectedVersion: o.version, changes: { qtyKg: '5' } }))).toBe('OFFER_EXPIRED');
      expect((await offers.get(pool, o.id))!.status).toBe('PENDING');
      expect(await svc.expireDue(clock)).toBeGreaterThanOrEqual(1);
      expect(await svc.reject(m.farmerActor, { offerId: o.id })).toMatchObject({ ok: false, error: { code: 'INVALID_STATE', details: { state: 'EXPIRED' } } });
    });
  });

  describe('Idempotency-Key', () => {
    it('replays the same offer for the same key and request, and rejects a different request', async () => {
      const m = await market();
      const a = val(await svc.create(m.factoryActor, buy(m), { idempotencyKey: 'k-1' }));
      const b = val(await svc.create(m.factoryActor, buy(m), { idempotencyKey: 'k-1' }));
      expect(a.replayed).toBe(false);
      expect(b).toMatchObject({ replayed: true });
      expect(b.offer.id).toBe(a.offer.id);
      expect(a.offer.idempotency_key).toBe('k-1');
      expect(code(await svc.create(m.factoryActor, buy(m, { qtyKg: '5' }), { idempotencyKey: 'k-1' }))).toBe('IDEMPOTENCY_MISMATCH');
      expect(await rows(`SELECT 1 FROM offers WHERE from_org_id = $1`, [m.factory.org.id])).toHaveLength(1);
    });

    it('creates one offer when the same key arrives concurrently', async () => {
      const m = await market();
      const res = await runConcurrently(6, () => svc.create(m.factoryActor, buy(m), { idempotencyKey: 'race' }));
      const oks = res.flatMap((r) => (r.status === 'fulfilled' && r.value.ok ? [r.value.value] : []));
      expect(oks.length).toBe(6);
      expect(new Set(oks.map((o: OfferResult) => o.offer.id)).size).toBe(1);
      expect(await rows(`SELECT 1 FROM offers WHERE from_org_id = $1`, [m.factory.org.id])).toHaveLength(1);
    });

    it('does not leave an offer behind when the keyed attempt fails, and supports keys on edit and reject', async () => {
      const m = await market();
      expect(code(await svc.create(m.factoryActor, buy(m, { qtyKg: '99999999' }), { idempotencyKey: 'bad' }))).toBe('INSUFFICIENT_QUANTITY');
      expect(await rows(`SELECT 1 FROM offers WHERE from_org_id = $1`, [m.factory.org.id])).toHaveLength(0);
      const o = val(await svc.create(m.factoryActor, buy(m))).offer;
      const e1 = val(await svc.edit(m.factoryActor, { offerId: o.id, expectedVersion: o.version, changes: { qtyKg: '10' } }, { idempotencyKey: 'e' }));
      const e2 = val(await svc.edit(m.factoryActor, { offerId: o.id, expectedVersion: o.version, changes: { qtyKg: '10' } }, { idempotencyKey: 'e' }));
      expect(e2.offer.id).toBe(e1.offer.id);
      expect(await rows(`SELECT 1 FROM offers WHERE from_org_id = $1`, [m.factory.org.id])).toHaveLength(2);
      const r1 = val(await svc.reject(m.farmerActor, { offerId: e1.offer.id }, { idempotencyKey: 'r' }));
      const r2 = val(await svc.reject(m.farmerActor, { offerId: e1.offer.id }, { idempotencyKey: 'r' }));
      expect([r1.replayed, r2.replayed]).toEqual([false, true]);
    });
  });

  describe('accept hook (task 8.2)', () => {
    it('wires the real accept transaction by default, for the receiver only (details in accept.db.test.ts)', async () => {
      const m = await market();
      const o = val(await svc.create(m.factoryActor, buy(m))).offer;
      expect(code(await svc.accept(m.factoryActor, { offerId: o.id }))).toBe('NOT_FOUND');
      expect((await offers.get(pool, o.id))!.status).toBe('PENDING');
      expect(code(await svc.accept(m.farmerActor, { offerId: o.id }))).toBe('OK');
      expect((await offers.get(pool, o.id))!.status).toBe('ACCEPTED');
    });

    it('delegates to the injected acceptor for the receiver only', async () => {
      const m = await market();
      const calls: string[] = [];
      const wired = createOfferService({ pool, now: () => clock }, {
        acceptor: async (a, i) => { calls.push(`${a.orgId}:${i.offerId}`); return { ok: true, value: 'accepted' }; },
      });
      const o = val(await wired.create(m.factoryActor, buy(m))).offer;
      expect(code(await wired.accept(m.factoryActor, { offerId: o.id }))).toBe('NOT_FOUND');
      expect(val(await wired.accept(m.farmerActor, { offerId: o.id }))).toBe('accepted');
      expect(calls).toEqual([`${m.farmer.org.id}:${o.id}`]);
    });
  });

  it('never stores a row the state machine forbids (only PENDING offers move)', async () => {
    const m = await market();
    const o: Offer = val(await svc.create(m.factoryActor, buy(m))).offer;
    val(await svc.withdraw(m.factoryActor, { offerId: o.id }));
    for (const f of [
      () => svc.reject(m.farmerActor, { offerId: o.id }),
      () => svc.withdraw(m.factoryActor, { offerId: o.id }),
      () => svc.edit(m.factoryActor, { offerId: o.id, expectedVersion: 2, changes: { qtyKg: '1' } }),
    ]) {
      expect(await f()).toMatchObject({ ok: false, error: { code: 'INVALID_STATE', details: { state: 'WITHDRAWN' } } });
    }
  });
});
