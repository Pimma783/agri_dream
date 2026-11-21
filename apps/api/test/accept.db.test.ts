import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/domain/permissions.js';
import {
  agreements, balingRequests, balingServices, demands, ledger, lineIdentities, listings, offers,
} from '../src/repos/index.js';
import { createOfferService, type AcceptResult, type OfferService, type Result } from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOrgWithUser } from './factories.js';

const HOUR = 3600_000;

describe.skipIf(!testDatabaseUrl)('accept offer (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let svc: OfferService;
  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    svc = createOfferService({ pool });
  });
  afterAll(async () => {
    await db?.close();
  });

  type Party = Awaited<ReturnType<typeof makeOrgWithUser>>;
  const actorOf = (p: Party, role: Actor['role']): Actor => ({ userId: p.user.id, orgId: p.org.id, role, channel: 'web' });
  const val = <T>(r: Result<T>): T => {
    if (!r.ok) throw new Error(`expected Ok, got ${r.error.code}`);
    return r.value;
  };
  const code = (r: Result<unknown>) => (r.ok ? 'OK' : r.error.code);
  const accepted = async (r: Promise<Result<unknown>>) => val(await r) as AcceptResult;
  const rows = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query<T>(sql, params)).rows;

  async function link(p: Party, channel: 'farmer' | 'baler' | 'factory') {
    const id = await lineIdentities.ensure(pool, channel, `U-synthetic-${p.org.id}`);
    await lineIdentities.link(pool, id.id, p.user.id, p.org.id);
  }

  /** Farmer sells to a factory; the factory sends the offers, the farmer accepts. */
  async function market(over: { listingQty?: string; demandQty?: string; minLot?: string } = {}) {
    const farmer = await makeOrgWithUser(pool, 'FARMER');
    const factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    await link(farmer, 'farmer');
    await link(factory, 'factory');
    const listing = await makeListing(pool, farmer.org.id, over.listingQty ? { qty: over.listingQty } : {});
    const demand = await makeDemand(pool, factory.org.id, { ...(over.demandQty ? { qty: over.demandQty } : {}), ...(over.minLot ? { min_lot_kg: over.minLot } : {}) });
    return { farmer, factory, listing, demand, farmerActor: actorOf(farmer, 'FARMER'), factoryActor: actorOf(factory, 'BUYER_FACTORY') };
  }
  type M = Awaited<ReturnType<typeof market>>;
  const send = async (m: M, qty = '1000', extra: Record<string, unknown> = {}) =>
    val(await svc.create(m.factoryActor, {
      kind: 'PURCHASE', listingId: m.listing.id, demandId: m.demand.id, qtyKg: qty, unitPriceThb: '1.5', priceUnit: 'KG', ...extra,
    })).offer;

  describe('purchase', () => {
    it('creates one PURCHASE_CONFIRMED agreement, moves quantity, writes ledger, audit and outbox for both parties', async () => {
      const m = await market();
      const o = await send(m, '1000');
      const r = await accepted(svc.accept(m.farmerActor, { offerId: o.id }));
      expect(r.replayed).toBe(false);
      expect(r.offer.status).toBe('ACCEPTED');
      expect(r.agreement).toMatchObject({
        kind: 'PURCHASE', status: 'PURCHASE_CONFIRMED', offer_id: o.id, seller_org_id: m.farmer.org.id, buyer_org_id: m.factory.org.id,
        listing_id: m.listing.id, demand_id: m.demand.id, qty_kg: '1000.000', total_amount_thb: '1500.00', resale_reserved_kg: '0.000',
      });
      const l = (await listings.get(pool, m.listing.id))!;
      const d = (await demands.get(pool, m.demand.id))!;
      expect([l.committed_qty_kg, l.remaining_qty_kg, l.status]).toEqual(['1000.000', '9000.000', 'PUBLISHED']);
      expect([d.committed_qty_kg, d.remaining_qty_kg, d.status]).toEqual(['1000.000', '49000.000', 'PUBLISHED']);
      expect(await ledger.listByAgreement(pool, r.agreement.id)).toMatchObject([
        { subject_type: 'LISTING', entry_kind: 'COMMIT', qty_kg: '1000.000' },
        { subject_type: 'DEMAND', entry_kind: 'COMMIT', qty_kg: '1000.000' },
      ]);
      const au = await rows<{ action: string; actor_org_id: string }>(
        `SELECT action, actor_org_id FROM audit_logs WHERE entity_id IN ($1, $2) AND action IN ('offer.accepted','agreement.created') ORDER BY action`,
        [o.id, r.agreement.id],
      );
      expect(au.map((a) => a.action)).toEqual(['agreement.created', 'offer.accepted']);
      expect(au.every((a) => a.actor_org_id === m.farmer.org.id)).toBe(true);
      const box = await rows<{ channel: string; dedupe_key: string; message: unknown }>(
        `SELECT channel, dedupe_key, message FROM notification_outbox WHERE related_id = $1 AND dedupe_key LIKE '%:accepted:%' ORDER BY channel`, [o.id],
      );
      expect(box.map((b) => b.channel)).toEqual(['factory', 'farmer']);
      const text = JSON.stringify(box[0]!.message);
      expect(text).toContain('ไม่ใช่หลักฐานการชำระเงิน');
      expect(text).not.toMatch(/ส่งมอบแล้ว|ชำระแล้ว|อัดเสร็จ/);
    });

    it('a repeat accept returns the same agreement and writes nothing', async () => {
      const m = await market();
      const o = await send(m);
      const a = await accepted(svc.accept(m.farmerActor, { offerId: o.id }));
      const before = await rows(`SELECT (SELECT count(*) FROM audit_logs) AS a, (SELECT count(*) FROM notification_outbox) AS n, (SELECT count(*) FROM quantity_ledger) AS q`);
      const b = await accepted(svc.accept(m.farmerActor, { offerId: o.id }));
      expect(b.agreement.id).toBe(a.agreement.id);
      expect(b.replayed).toBe(true);
      expect(await rows(`SELECT (SELECT count(*) FROM audit_logs) AS a, (SELECT count(*) FROM notification_outbox) AS n, (SELECT count(*) FROM quantity_ledger) AS q`)).toEqual(before);
      expect((await listings.get(pool, m.listing.id))!.remaining_qty_kg).toBe('9000.000');
      expect(await rows(`SELECT 1 FROM agreements WHERE offer_id = $1`, [o.id])).toHaveLength(1);
    });

    it('an Idempotency-Key replays the stored result; the same key with another request is a mismatch', async () => {
      const m = await market();
      const o = await send(m);
      const a = await accepted(svc.accept(m.farmerActor, { offerId: o.id, idempotencyKey: 'k1' }));
      const b = await accepted(svc.accept(m.farmerActor, { offerId: o.id, idempotencyKey: 'k1' }));
      expect([a.replayed, b.replayed]).toEqual([false, true]);
      expect(b.agreement.id).toBe(a.agreement.id);
      expect(code(await svc.accept(m.farmerActor, { offerId: o.id, idempotencyKey: 'k1', ackPendingMaterial: true }))).toBe('IDEMPOTENCY_MISMATCH');
      expect((await listings.get(pool, m.listing.id))!.committed_qty_kg).toBe('1000.000');
    });

    it('also works when the farmer sent the offer and the factory accepts', async () => {
      const m = await market();
      const o = val(await svc.create(m.farmerActor, { kind: 'PURCHASE', listingId: m.listing.id, demandId: m.demand.id, qtyKg: '2500' })).offer;
      expect(code(await svc.accept(m.farmerActor, { offerId: o.id }))).toBe('NOT_FOUND');
      const r = await accepted(svc.accept(m.factoryActor, { offerId: o.id }));
      expect(r.agreement).toMatchObject({ seller_org_id: m.farmer.org.id, buyer_org_id: m.factory.org.id, qty_kg: '2500.000', total_amount_thb: null });
    });

    it('takes a partial quantity and keeps the listing open; a second accept takes more', async () => {
      const m = await market({ listingQty: '3000' });
      const a = await accepted(svc.accept(m.farmerActor, { offerId: (await send(m, '1000')).id }));
      const l1 = (await listings.get(pool, m.listing.id))!;
      expect([l1.remaining_qty_kg, l1.status]).toEqual(['2000.000', 'PUBLISHED']);
      // The second offer was made after the first accept, so its snapshot is current.
      const b = await accepted(svc.accept(m.farmerActor, { offerId: (await send(m, '1500')).id }));
      expect(b.agreement.id).not.toBe(a.agreement.id);
      const l2 = (await listings.get(pool, m.listing.id))!;
      expect([l2.committed_qty_kg, l2.remaining_qty_kg, l2.status]).toEqual(['2500.000', '500.000', 'PUBLISHED']);
    });

    it('a pending offer made before another accept is not stale just because quantity moved', async () => {
      const m = await market({ listingQty: '3000' });
      const first = await send(m, '1000');
      const second = await send(m, '1000');
      await accepted(svc.accept(m.farmerActor, { offerId: first.id }));
      const r = await accepted(svc.accept(m.farmerActor, { offerId: second.id }));
      expect(r.agreement.status).toBe('PURCHASE_CONFIRMED');
      expect((await listings.get(pool, m.listing.id))!.remaining_qty_kg).toBe('1000.000');
    });

    it('closes the listing (and the demand) when remaining reaches zero', async () => {
      const m = await market({ listingQty: '1000', demandQty: '1000' });
      await accepted(svc.accept(m.farmerActor, { offerId: (await send(m, '1000')).id }));
      const l = (await listings.get(pool, m.listing.id))!;
      const d = (await demands.get(pool, m.demand.id))!;
      expect([l.remaining_qty_kg, l.committed_qty_kg, l.status]).toEqual(['0.000', '1000.000', 'CLOSED']);
      expect([d.remaining_qty_kg, d.status]).toEqual(['0.000', 'CLOSED']);
    });

    it('insufficient quantity returns 409 INSUFFICIENT_QUANTITY, the offer stays PENDING and nothing is written', async () => {
      const m = await market({ listingQty: '1500' });
      const a = await send(m, '1000');
      const b = await send(m, '1000');
      await accepted(svc.accept(m.farmerActor, { offerId: a.id }));
      const r = await svc.accept(m.farmerActor, { offerId: b.id });
      expect(r).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_QUANTITY' } });
      expect((await offers.get(pool, b.id))!.status).toBe('PENDING');
      expect(await agreements.getByOffer(pool, b.id)).toBeNull();
      expect(await rows(`SELECT 1 FROM notification_outbox WHERE related_id = $1 AND dedupe_key LIKE '%:accepted:%'`, [b.id])).toHaveLength(0);
      expect((await listings.get(pool, m.listing.id))!.remaining_qty_kg).toBe('500.000');
    });

    it('refuses an expired offer (offer stays PENDING until the sweeper runs) and a stranger', async () => {
      const m = await market();
      const o = await send(m, '1000', { expiresAt: new Date(Date.now() + 2 * HOUR).toISOString() });
      const late = createOfferService({ pool, now: () => new Date(Date.now() + 3 * HOUR) });
      expect(code(await late.accept(m.farmerActor, { offerId: o.id }))).toBe('OFFER_EXPIRED');
      expect((await offers.get(pool, o.id))!.status).toBe('PENDING');
      expect(await agreements.getByOffer(pool, o.id)).toBeNull();
      const other = await makeOrgWithUser(pool, 'FARMER');
      expect(code(await svc.accept(actorOf(other, 'FARMER'), { offerId: o.id }))).toBe('NOT_FOUND');
    });

    it('refuses a non-PENDING offer with INVALID_STATE', async () => {
      const m = await market();
      const o = await send(m);
      val(await svc.reject(m.farmerActor, { offerId: o.id }));
      expect(await svc.accept(m.farmerActor, { offerId: o.id })).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
    });

    it('refuses when the listing terms changed after the offer (STALE_VERSION) or it is no longer published', async () => {
      const m = await market();
      const o = await send(m);
      await listings.update(pool, m.listing.id, { unit_price_thb: '9.0000' });
      expect(code(await svc.accept(m.farmerActor, { offerId: o.id }))).toBe('STALE_VERSION');
      const m2 = await market();
      const o2 = await send(m2);
      await demands.update(pool, m2.demand.id, { status: 'PAUSED' });
      expect(code(await svc.accept(m2.farmerActor, { offerId: o2.id }))).toBe('INVALID_STATE');
      expect((await offers.get(pool, o.id))!.status).toBe('PENDING');
    });

    it('refuses a quantity below the buyer minimum lot', async () => {
      const m = await market({ minLot: '2000' });
      const o = val(await svc.create(m.farmerActor, { kind: 'PURCHASE', listingId: m.listing.id, demandId: m.demand.id, qtyKg: '2000' })).offer;
      await pool.query(`UPDATE offers SET qty_kg = 500 WHERE id = $1`, [o.id]); // the lot rule is re-checked at accept time
      expect(code(await svc.accept(m.factoryActor, { offerId: o.id }))).toBe('VALIDATION');
      expect((await offers.get(pool, o.id))!.status).toBe('PENDING');
    });

    it('a resale listing with pending material needs the acknowledgement; the agreement links the source agreement', async () => {
      const m = await market();
      const src = (await accepted(svc.accept(m.farmerActor, { offerId: (await send(m, '1000')).id }))).agreement;
      const dest = await makeOrgWithUser(pool, 'BUYER_FACTORY');
      await link(dest, 'factory');
      // The factory above stands in for the baler that bought the straw and now resells it.
      const resale = await makeListing(pool, m.factory.org.id, {
        kind: 'RESALE', pending_material: true, expected_ready_at: new Date(Date.now() + 24 * HOUR), source_agreement_id: src.id, qty: '800',
      });
      const demand = await makeDemand(pool, dest.org.id);
      // Raw offer without the acknowledgement (the service would refuse to create it).
      const raw = await offers.insert(pool, {
        kind: 'PURCHASE', from_org_id: dest.org.id, to_org_id: m.factory.org.id, listing_id: resale.id, demand_id: demand.id,
        qty_kg: '500.000', transport_by: 'BUYER', expires_at: new Date(Date.now() + 24 * HOUR), status: 'PENDING',
        listing_version: resale.version, demand_version: demand.version, ack_pending_material: false,
      });
      const receiver = actorOf(m.factory, 'BUYER_FACTORY');
      expect(await svc.accept(receiver, { offerId: raw.id })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
      expect((await offers.get(pool, raw.id))!.status).toBe('PENDING');
      const r = await accepted(svc.accept(receiver, { offerId: raw.id, ackPendingMaterial: true }));
      expect(r.agreement).toMatchObject({ status: 'PURCHASE_CONFIRMED', source_agreement_id: src.id });
    });
  });

  describe('baling service', () => {
    async function balingMarket() {
      const baler = await makeOrgWithUser(pool, 'BALER');
      const farmer = await makeOrgWithUser(pool, 'FARMER');
      await link(baler, 'baler');
      await link(farmer, 'farmer');
      const service = await balingServices.insert(pool, {
        org_id: baler.org.id, material_types: ['RICE_STRAW'], service_mode: 'BOTH', price_mode: 'FIXED', status: 'PUBLISHED',
        unit_price_thb: '0.5000', price_unit: 'KG', min_qty_kg: '100', is_demo: false,
      });
      const request = await balingRequests.insert(pool, {
        org_id: farmer.org.id, material_type: 'RICE_STRAW', qty_kg: '5000.000', requested_mode: 'ON_SITE', status: 'PUBLISHED', is_demo: false,
      });
      return { baler, farmer, service, request, balerActor: actorOf(baler, 'BALER'), farmerActor: actorOf(farmer, 'FARMER') };
    }

    it('creates a SERVICE_CONFIRMED agreement and writes no quantity or ledger rows, whoever sent the offer', async () => {
      for (const sender of ['baler', 'farmer'] as const) {
        const b = await balingMarket();
        const from = sender === 'baler' ? b.balerActor : b.farmerActor;
        const to = sender === 'baler' ? b.farmerActor : b.balerActor;
        const o = val(await svc.create(from, {
          kind: 'BALING_SERVICE', balingServiceId: b.service.id, balingRequestId: b.request.id, qtyKg: '4000', unitPriceThb: '0.5', priceUnit: 'KG',
        })).offer;
        const ledgerBefore = await rows(`SELECT count(*) AS n FROM quantity_ledger`);
        const r = await accepted(svc.accept(to, { offerId: o.id }));
        expect(r.agreement).toMatchObject({
          kind: 'BALING_SERVICE', status: 'SERVICE_CONFIRMED', seller_org_id: b.baler.org.id, buyer_org_id: b.farmer.org.id,
          baling_service_id: b.service.id, baling_request_id: b.request.id, listing_id: null, demand_id: null, qty_kg: '4000.000',
        });
        expect(await rows(`SELECT count(*) AS n FROM quantity_ledger`)).toEqual(ledgerBefore);
        expect(await ledger.listByAgreement(pool, r.agreement.id)).toEqual([]);
        expect((await balingRequests.get(pool, b.request.id))!).toMatchObject({ qty_kg: '5000.000', status: 'PUBLISHED', version: b.request.version });
        expect((await balingServices.get(pool, b.service.id))!.version).toBe(b.service.version);
        expect((await offers.get(pool, o.id))!.status).toBe('ACCEPTED');
        const box = await rows<{ message: unknown }>(`SELECT message FROM notification_outbox WHERE related_id = $1 AND dedupe_key LIKE '%:accepted:%'`, [o.id]);
        expect(box).toHaveLength(2);
        expect(JSON.stringify(box[0]!.message)).toContain('ไม่ใช่หลักฐานว่าอัดเสร็จแล้ว');
        // repeat returns the same agreement
        expect((await accepted(svc.accept(to, { offerId: o.id }))).agreement.id).toBe(r.agreement.id);
      }
    });

    it('refuses a baling offer whose service is no longer published, leaving the offer PENDING', async () => {
      const b = await balingMarket();
      const o = val(await svc.create(b.balerActor, { kind: 'BALING_SERVICE', balingServiceId: b.service.id, balingRequestId: b.request.id, qtyKg: '1000' })).offer;
      await balingServices.update(pool, b.service.id, { status: 'PAUSED' });
      expect(code(await svc.accept(b.farmerActor, { offerId: o.id }))).toBe('INVALID_STATE');
      expect((await offers.get(pool, o.id))!.status).toBe('PENDING');
    });
  });
});
