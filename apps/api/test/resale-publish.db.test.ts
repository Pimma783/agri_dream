// Resale publishing, route 4 and downstream accept against real Postgres (task 16.3). Synthetic data only.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor, Role } from '../src/domain/permissions.js';
import { agreements, listings as listingRepo, resaleAllocations } from '../src/repos/index.js';
import {
  type AcceptResult, createDraftService, createListingService, createMatchingService, createOfferService, createResaleService,
  toAgreementViewFor, type Result,
} from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOffer, makeOrgWithUser } from './factories.js';

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`unexpected error ${r.error.code}`);
  return r.value;
}
const codeOf = <T>(r: Result<T>): string => (r.ok ? 'OK' : r.error.code);

describe.skipIf(!testDatabaseUrl)('resale publish, route 4 and downstream accept (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let resale: ReturnType<typeof createResaleService>;
  let drafts: ReturnType<typeof createDraftService>;
  let listings: ReturnType<typeof createListingService>;
  let offers: ReturnType<typeof createOfferService>;
  let matching: ReturnType<typeof createMatchingService>;

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    resale = createResaleService({ pool });
    drafts = createDraftService({ pool });
    listings = createListingService({ pool });
    offers = createOfferService({ pool });
    matching = createMatchingService({ pool });
  });
  afterAll(async () => {
    await db?.close();
  });

  const actorFor = (o: { org: { id: string }; user: { id: string } }, role: Role): Actor => ({ userId: o.user.id, orgId: o.org.id, role, channel: 'web' });
  const reserved = async (id: string) => (await agreements.get(pool, id))!.resale_reserved_kg;

  /** Farmer sold `qty` kg to a baler; the baler holds a PURCHASE_CONFIRMED agreement and a draft for `resaleQty`. */
  async function setup(qty = '1000', resaleQty = '800') {
    const farmer = await makeOrgWithUser(pool, 'FARMER');
    const baler = await makeOrgWithUser(pool, 'BALER');
    const factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    const src = await makeListing(pool, farmer.org.id, { qty, material_type: 'CANE_LEAF', lat: '17.123456', lng: '100.123456' });
    const srcDemand = await makeDemand(pool, baler.org.id, { accepted_materials: ['CANE_LEAF'] });
    const srcOffer = await makeOffer(pool, { listing: src, demand: srcDemand }, { qty_kg: qty });
    const agreement = await agreements.insert(pool, {
      kind: 'PURCHASE', offer_id: srcOffer.id, seller_org_id: farmer.org.id, buyer_org_id: baler.org.id,
      listing_id: src.id, demand_id: srcDemand.id, qty_kg: qty, status: 'PURCHASE_CONFIRMED',
    });
    const balerActor = actorFor(baler, 'BALER');
    const draft = unwrap(await resale.createDraft(balerActor, { agreementId: agreement.id, qtyKg: resaleQty }));
    return { farmer, baler, factory, agreement, balerActor, factoryActor: actorFor(factory, 'BUYER_FACTORY'), draft };
  }
  type S = Awaited<ReturnType<typeof setup>>;

  const COMPLETE = { price_mode: 'NEGOTIABLE', province: 'Uttaradit', lat: '17.620000', lng: '100.100000', expected_ready_at: '2030-01-01' } as const;

  async function publish(s: S) {
    const patched = unwrap(await drafts.patch(s.balerActor, { draftId: s.draft.draft.id, expectedVersion: s.draft.draft.version, patch: COMPLETE }));
    expect(patched.draft.status).toBe('AWAITING_REVIEW');
    return drafts.publish(s.balerActor, { draftId: patched.draft.id, expectedVersion: patched.draft.version });
  }

  async function published(s: S) {
    const p = unwrap(await publish(s));
    return (await listingRepo.get(pool, p.entity_id))!;
  }

  it('publishing sets listing_id on the allocation and creates a pending RESALE listing linked to the source', async () => {
    const s = await setup();
    const l = await published(s);
    expect(l).toMatchObject({
      kind: 'RESALE', pending_material: true, source_agreement_id: s.agreement.id, total_qty_kg: '800.000', org_id: s.baler.org.id,
    });
    expect(l.expected_ready_at?.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect(await resaleAllocations.getByListing(pool, l.id)).toMatchObject({
      status: 'ACTIVE', qty_kg: '800.000', draft_id: s.draft.draft.id, source_agreement_id: s.agreement.id,
    });
    expect(await reserved(s.agreement.id)).toBe('800.000');
  });

  it('refuses to publish when the listing quantity exceeds the reserved allocation, and when the allocation is released', async () => {
    const s = await setup();
    const patched = unwrap(await drafts.patch(s.balerActor, { draftId: s.draft.draft.id, expectedVersion: 1, patch: COMPLETE }));
    await pool.query(`UPDATE resale_allocations SET qty_kg = 500 WHERE draft_id = $1`, [s.draft.draft.id]);
    expect(codeOf(await drafts.publish(s.balerActor, { draftId: patched.draft.id, expectedVersion: patched.draft.version }))).toBe('ALLOCATION_EXCEEDED');
    expect((await pool.query(`SELECT count(*)::int AS n FROM material_listings WHERE source_draft_id = $1`, [s.draft.draft.id])).rows[0].n).toBe(0);
    await pool.query(`UPDATE resale_allocations SET status = 'RELEASED' WHERE draft_id = $1`, [s.draft.draft.id]);
    expect(codeOf(await drafts.publish(s.balerActor, { draftId: patched.draft.id, expectedVersion: patched.draft.version }))).toBe('INVALID_STATE');
  });

  it('refuses to publish while expected_ready_at is missing for pending material', async () => {
    const s = await setup();
    const { expected_ready_at: _omit, ...rest } = COMPLETE;
    const patched = unwrap(await drafts.patch(s.balerActor, { draftId: s.draft.draft.id, expectedVersion: 1, patch: rest }));
    expect(patched.missing_fields).toContain('expected_ready_at');
    expect(codeOf(await drafts.publish(s.balerActor, { draftId: patched.draft.id, expectedVersion: patched.draft.version }))).not.toBe('OK');
  });

  it('computes route 4 for a published resale listing against a factory demand and shows pending material', async () => {
    const s = await setup();
    const l = await published(s);
    const demand = await makeDemand(pool, s.factory.org.id, { accepted_materials: ['CANE_LEAF'], lat: '17.720000', lng: '100.100000' });
    unwrap(await matching.recompute({ entity_type: 'LISTING', entity_id: l.id, version: 1 }));
    const m = await pool.query(`SELECT route, demand_id FROM matches WHERE supply_id = $1`, [l.id]);
    expect(m.rows).toContainEqual({ route: 4, demand_id: demand.id });
  });

  it('downstream offer needs ack_pending_material; accept creates a linked PURCHASE agreement without received/baled status', async () => {
    const s = await setup();
    const l = await published(s);
    const demand = await makeDemand(pool, s.factory.org.id, { accepted_materials: ['CANE_LEAF'], lat: '17.720000', lng: '100.100000' });
    const base = { kind: 'PURCHASE' as const, listingId: l.id, demandId: demand.id, qtyKg: '300', unitPriceThb: '1.5', priceUnit: 'KG' as const };
    expect(codeOf(await offers.create(s.factoryActor, base))).toBe('VALIDATION');
    const offer = unwrap(await offers.create(s.factoryActor, { ...base, ackPendingMaterial: true })).offer;
    expect(offer.ack_pending_material).toBe(true);

    const r = unwrap(await offers.accept(s.balerActor, { offerId: offer.id })) as AcceptResult;
    expect(r.agreement).toMatchObject({
      kind: 'PURCHASE', status: 'PURCHASE_CONFIRMED', source_agreement_id: s.agreement.id,
      seller_org_id: s.baler.org.id, buyer_org_id: s.factory.org.id, listing_id: l.id, qty_kg: '300.000',
    });
    expect(JSON.stringify(r.agreement)).not.toMatch(/RECEIVED|BALED|DELIVERED/);
    expect((await listingRepo.get(pool, l.id))!.remaining_qty_kg).toBe('500.000');

    // The downstream factory sees no link to the upstream agreement and nothing of the farmer.
    const downstream = toAgreementViewFor(r.agreement, s.factory.org.id);
    expect(downstream.source_agreement_id).toBeNull();
    const json = JSON.stringify(downstream);
    for (const secret of [s.farmer.org.id, s.farmer.user.id, s.agreement.id, '17.123456']) expect(json).not.toContain(secret);
    // The baler who resold keeps the trace.
    expect(toAgreementViewFor(r.agreement, s.baler.org.id).source_agreement_id).toBe(s.agreement.id);

    // Closing the resale listing keeps the 300 kg sold and releases the unsold remainder.
    unwrap(await listings.close(s.balerActor, { id: l.id, expectedVersion: (await listingRepo.get(pool, l.id))!.version }));
    expect(await reserved(s.agreement.id)).toBe('300.000');
    expect(await resaleAllocations.getByListing(pool, l.id)).toMatchObject({ status: 'ACTIVE', qty_kg: '300.000' });
  });
});
