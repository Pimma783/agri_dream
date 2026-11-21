// Resale draft creation and allocation against real Postgres (task 16.1). Synthetic data only.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvSchema } from '../src/config/env.js';
import type { Actor, Role } from '../src/domain/permissions.js';
import { mountResaleRoutes } from '../src/http/resale-routes.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/logger.js';
import { agreements, resaleAllocations, withTransaction } from '../src/repos/index.js';
import { createAuthService, createDemoOrgUser, LoginRateLimiter } from '../src/services/auth/index.js';
import {
  createDraftService, createListingService, createResaleService, type DraftView, type Result,
} from '../src/services/index.js';
import { createTestDb, runConcurrently, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOffer, makeOrgWithUser } from './factories.js';

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`unexpected error ${r.error.code}`);
  return r.value;
}
const codeOf = <T>(r: Result<T>): string => (r.ok ? 'OK' : r.error.code);

describe.skipIf(!testDatabaseUrl)('resale draft and allocation (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let resale: ReturnType<typeof createResaleService>;
  let drafts: ReturnType<typeof createDraftService>;
  let listings: ReturnType<typeof createListingService>;

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    resale = createResaleService({ pool });
    drafts = createDraftService({ pool });
    listings = createListingService({ pool });
  });
  afterAll(async () => {
    await db?.close();
  });

  const actorFor = (o: { org: { id: string }; user: { id: string } }, role: Role): Actor => ({ userId: o.user.id, orgId: o.org.id, role, channel: 'web' });

  /** A farmer sells to a BALER; the agreement is PURCHASE_CONFIRMED for `qty` kg. */
  async function setup(qty = '1000', status: 'PURCHASE_CONFIRMED' | 'CANCELLED' = 'PURCHASE_CONFIRMED') {
    const farmer = await makeOrgWithUser(pool, 'FARMER');
    const baler = await makeOrgWithUser(pool, 'BALER');
    const listing = await makeListing(pool, farmer.org.id, {
      qty, province: 'FarmerVillageProvince', district: 'FarmerDistrict', lat: '17.123456', lng: '100.123456', material_type: 'CANE_LEAF',
    });
    const demand = await makeDemand(pool, baler.org.id);
    const offer = await makeOffer(pool, { listing, demand }, { qty_kg: qty });
    const agreement = (await agreements.insert(pool, {
      kind: 'PURCHASE', offer_id: offer.id, seller_org_id: farmer.org.id, buyer_org_id: baler.org.id,
      listing_id: listing.id, demand_id: demand.id, qty_kg: qty, status,
    }));
    return { farmer, baler, listing, agreement, balerActor: actorFor(baler, 'BALER'), farmerActor: actorFor(farmer, 'FARMER') };
  }
  const reserved = async (id: string) => (await agreements.get(pool, id))!.resale_reserved_kg;
  const qtyOf = (v: DraftView) => v.draft.data.qty_kg;

  it('creates an unpublished RESALE_LISTING draft with source, material, default quantity and pending material', async () => {
    const s = await setup('1000');
    const v = unwrap(await resale.createDraft(s.balerActor, { agreementId: s.agreement.id }));
    expect(v.draft).toMatchObject({
      kind: 'RESALE_LISTING', status: 'DRAFT', org_id: s.baler.org.id, source_agreement_id: s.agreement.id, published_entity_id: null,
    });
    expect(v.draft.data).toEqual({ material_type: 'CANE_LEAF', qty_kg: '1000.000', pending_material: true });
    expect(v.complete).toBe(false);
    expect(v.missing_fields).toContain('expected_ready_at');
    expect(await reserved(s.agreement.id)).toBe('1000.000');
    const alloc = await resaleAllocations.getByDraft(pool, v.draft.id);
    expect(alloc).toMatchObject({ source_agreement_id: s.agreement.id, qty_kg: '1000.000', status: 'ACTIVE' });
    const published = await pool.query(`SELECT count(*)::int AS n FROM material_listings WHERE kind = 'RESALE' AND source_agreement_id = $1`, [s.agreement.id]);
    expect(published.rows[0].n).toBe(0);
  });

  it('copies no farmer data, source location or assessment into the draft', async () => {
    const s = await setup('500');
    const v = unwrap(await resale.createDraft(s.balerActor, { agreementId: s.agreement.id }));
    const json = JSON.stringify(v.draft);
    for (const secret of ['FarmerVillageProvince', 'FarmerDistrict', '17.123456', '100.123456', s.farmer.org.id, s.farmer.user.id, 'example.invalid']) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(v.draft.data).sort()).toEqual(['material_type', 'pending_material', 'qty_kg']);
    expect(v.draft.data.expected_ready_at).toBeUndefined();
  });

  it('refuses other roles (403), other organizations and unknown ids (404), and non-confirmed agreements (409)', async () => {
    const s = await setup('1000');
    expect(codeOf(await resale.createDraft(s.farmerActor, { agreementId: s.agreement.id }))).toBe('FORBIDDEN');
    const factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    expect(codeOf(await resale.createDraft(actorFor(factory, 'BUYER_FACTORY'), { agreementId: s.agreement.id }))).toBe('FORBIDDEN');
    const otherBaler = await makeOrgWithUser(pool, 'BALER');
    expect(codeOf(await resale.createDraft(actorFor(otherBaler, 'BALER'), { agreementId: s.agreement.id }))).toBe('NOT_FOUND');
    expect(codeOf(await resale.createDraft(s.balerActor, { agreementId: '00000000-0000-4000-8000-000000000000' }))).toBe('NOT_FOUND');
    expect(codeOf(await resale.createDraft(s.balerActor, { agreementId: 'nope' }))).toBe('NOT_FOUND');
    const cancelled = await setup('1000', 'CANCELLED');
    expect(codeOf(await resale.createDraft(cancelled.balerActor, { agreementId: cancelled.agreement.id }))).toBe('INVALID_STATE');
    expect(await reserved(s.agreement.id)).toBe('0.000');
    expect(await pool.query(`SELECT 1 FROM drafts WHERE kind = 'RESALE_LISTING' AND source_agreement_id = $1`, [s.agreement.id])).toHaveProperty('rowCount', 0);
  });

  it('drafts.create still refuses RESALE_LISTING', async () => {
    const s = await setup('100');
    const r = await drafts.create(s.balerActor, { kind: 'RESALE_LISTING' });
    expect(r.ok).toBe(false);
    expect(codeOf(r)).toBe('VALIDATION');
  });

  it('reserves across several drafts, defaults to the unreserved rest, and refuses over the cap', async () => {
    const s = await setup('1000');
    const a = unwrap(await resale.createDraft(s.balerActor, { agreementId: s.agreement.id, qtyKg: '600' }));
    const b = unwrap(await resale.createDraft(s.balerActor, { agreementId: s.agreement.id }));
    expect(qtyOf(a)).toBe('600.000');
    expect(qtyOf(b)).toBe('400.000');
    expect(await reserved(s.agreement.id)).toBe('1000.000');
    expect(codeOf(await resale.createDraft(s.balerActor, { agreementId: s.agreement.id }))).toBe('ALLOCATION_EXCEEDED');
    expect(codeOf(await resale.createDraft(s.balerActor, { agreementId: s.agreement.id, qtyKg: '0.001' }))).toBe('ALLOCATION_EXCEEDED');
    expect(codeOf(await resale.createDraft(s.balerActor, { agreementId: s.agreement.id, qtyKg: '-5' }))).toBe('VALIDATION');
    expect(await resaleAllocations.activeTotal(pool, s.agreement.id)).toBe('1000.000');
  });

  it('re-checks the cap when the draft quantity is edited', async () => {
    const s = await setup('1000');
    const a = unwrap(await resale.createDraft(s.balerActor, { agreementId: s.agreement.id, qtyKg: '600' }));
    unwrap(await resale.createDraft(s.balerActor, { agreementId: s.agreement.id, qtyKg: '300' }));
    const up = await drafts.patch(s.balerActor, { draftId: a.draft.id, expectedVersion: 1, patch: { quantity: { value: '800', unit: 'kg' } } });
    expect(codeOf(up)).toBe('ALLOCATION_EXCEEDED');
    expect(await reserved(s.agreement.id)).toBe('900.000');
    expect((await drafts.get(s.balerActor, a.draft.id) as { ok: true; value: DraftView }).value.draft.data.qty_kg).toBe('600.000');
    const ok = unwrap(await drafts.patch(s.balerActor, { draftId: a.draft.id, expectedVersion: 1, patch: { quantity: { value: '700', unit: 'kg' } } }));
    expect(qtyOf(ok)).toBe('700.000');
    expect(await reserved(s.agreement.id)).toBe('1000.000');
    unwrap(await drafts.patch(s.balerActor, { draftId: a.draft.id, expectedVersion: 2, patch: { quantity: { value: '100', unit: 'kg' } } }));
    expect(await reserved(s.agreement.id)).toBe('400.000');
    expect(await resaleAllocations.activeTotal(pool, s.agreement.id)).toBe('400.000');
  });

  it('releases the reservation when the draft is cancelled, and a second cancel changes nothing', async () => {
    const s = await setup('1000');
    const a = unwrap(await resale.createDraft(s.balerActor, { agreementId: s.agreement.id, qtyKg: '700' }));
    expect(await reserved(s.agreement.id)).toBe('700.000');
    const c = unwrap(await drafts.cancel(s.balerActor, { draftId: a.draft.id, expectedVersion: 1 }));
    expect(c.draft.status).toBe('CANCELLED');
    expect(await reserved(s.agreement.id)).toBe('0.000');
    expect((await resaleAllocations.getByDraft(pool, a.draft.id))?.status).toBe('RELEASED');
    expect(codeOf(await drafts.cancel(s.balerActor, { draftId: a.draft.id, expectedVersion: 2 }))).toBe('INVALID_STATE');
    expect(await reserved(s.agreement.id)).toBe('0.000');
    // the freed quantity can be reserved again
    expect(qtyOf(unwrap(await resale.createDraft(s.balerActor, { agreementId: s.agreement.id })))).toBe('1000.000');
  });

  it('closing or cancelling a resale listing keeps the sold quantity and frees the unsold rest', async () => {
    const s = await setup('1000');
    const d = unwrap(await resale.createDraft(s.balerActor, { agreementId: s.agreement.id, qtyKg: '800' }));
    // Link a published resale listing to the allocation the way publishing (task 16.3) will.
    const rl = await makeListing(pool, s.baler.org.id, { kind: 'RESALE', qty: '800', source_agreement_id: s.agreement.id });
    await pool.query(`UPDATE material_listings SET committed_qty_kg = 500, remaining_qty_kg = 300 WHERE id = $1`, [rl.id]); // 500 sold
    const alloc = (await resaleAllocations.getByDraft(pool, d.draft.id))!;
    await withTransaction(pool, (tx) => resaleAllocations.update(tx, alloc.id, { listing_id: rl.id }));
    const closed = unwrap(await listings.close(s.balerActor, { id: rl.id, expectedVersion: rl.version }));
    expect(closed.status).toBe('CLOSED');
    expect(await reserved(s.agreement.id)).toBe('500.000');
    expect(await resaleAllocations.getByListing(pool, rl.id)).toMatchObject({ qty_kg: '500.000', status: 'ACTIVE' });
    expect(await resaleAllocations.activeTotal(pool, s.agreement.id)).toBe('500.000');

    const s2 = await setup('1000');
    const d2 = unwrap(await resale.createDraft(s2.balerActor, { agreementId: s2.agreement.id, qtyKg: '800' }));
    const rl2 = await makeListing(pool, s2.baler.org.id, { kind: 'RESALE', qty: '800', source_agreement_id: s2.agreement.id });
    const alloc2 = (await resaleAllocations.getByDraft(pool, d2.draft.id))!;
    await withTransaction(pool, (tx) => resaleAllocations.update(tx, alloc2.id, { listing_id: rl2.id }));
    unwrap(await listings.cancel(s2.balerActor, { id: rl2.id, expectedVersion: rl2.version }));
    expect(await reserved(s2.agreement.id)).toBe('0.000');
    expect((await resaleAllocations.getByListing(pool, rl2.id))?.status).toBe('RELEASED');
  });

  it('concurrent creations never reserve more than the agreement quantity', async () => {
    const s = await setup('1000');
    const results = await runConcurrently(12, () => resale.createDraft(s.balerActor, { agreementId: s.agreement.id, qtyKg: '300' }));
    const outcomes = results.map((r) => (r.status === 'fulfilled' ? codeOf(r.value) : 'THROWN'));
    expect(outcomes.filter((o) => o === 'OK')).toHaveLength(3);
    expect(outcomes.filter((o) => o === 'ALLOCATION_EXCEEDED')).toHaveLength(9);
    expect(await reserved(s.agreement.id)).toBe('900.000');
    expect(await resaleAllocations.activeTotal(pool, s.agreement.id)).toBe('900.000');
    const n = await pool.query(`SELECT count(*)::int AS n FROM drafts WHERE source_agreement_id = $1`, [s.agreement.id]);
    expect(n.rows[0].n).toBe(3);
  });

  describe('POST /agreements/:id/resale-draft', () => {
    const ORIGIN = 'http://localhost:3000';
    const PW = 'synthetic-Passw0rd-for-tests';
    let server: Server;
    let base: string;
    let seq = 0;
    beforeAll(async () => {
      const auth = createAuthService({
        pool, config: { idleMs: 3_600_000, absoluteMs: 18_000_000 }, limiter: new LoginRateLimiter({ maxAttempts: 1000, windowMs: 60_000 }),
      });
      const env = EnvSchema.parse({ NODE_ENV: 'test', WEB_ORIGIN: ORIGIN });
      const app = createApp({ env, logger: createLogger('silent'), auth, mountRoutes: (a) => mountResaleRoutes(a, { pool }) });
      server = await new Promise<Server>((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      await new Promise<void>((r) => server?.close(() => r()));
    });
    async function login(kind: 'BALER' | 'FARMER') {
      const email = `resale-route-${++seq}@example.invalid`;
      const { org } = await createDemoOrgUser(pool, { kind, orgName: `synthetic-resale-org-${seq}`, email, password: PW });
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password: PW }),
      });
      const cookie = `agrimatch_sid=${/agrimatch_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`;
      const me = (await (await fetch(`${base}/me`, { headers: { cookie } })).json()) as { csrf_secret: string };
      return { cookie, csrf: me.csrf_secret, orgId: org.id };
    }
    const post = (s: { cookie: string; csrf: string } | null, path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(s ? { cookie: s.cookie, origin: ORIGIN, 'x-csrf-token': s.csrf } : {}) },
        body: JSON.stringify(body),
      });

    it('201 for the buyer BALER, 403 for a farmer, 404 for another BALER, 401 without a session, 422 for a bad body', async () => {
      const baler = await login('BALER');
      const farmer = await login('FARMER');
      const other = await login('BALER');
      const listing = await makeListing(pool, farmer.orgId);
      const demand = await makeDemand(pool, baler.orgId);
      const offer = await makeOffer(pool, { listing, demand });
      const ag = await agreements.insert(pool, {
        kind: 'PURCHASE', offer_id: offer.id, seller_org_id: farmer.orgId, buyer_org_id: baler.orgId,
        listing_id: listing.id, demand_id: demand.id, qty_kg: '1000.000', status: 'PURCHASE_CONFIRMED',
      });
      const path = `/agreements/${ag.id}/resale-draft`;
      expect((await post(null, path, {})).status).toBe(401);
      expect((await post(farmer, path, {})).status).toBe(403);
      expect((await post(other, path, {})).status).toBe(404);
      expect((await post(baler, path, { qty: 5 })).status).toBe(422);
      const ok = await post(baler, path, { qtyKg: '250' });
      expect(ok.status).toBe(201);
      const body = (await ok.json()) as DraftView;
      expect(body.draft).toMatchObject({ kind: 'RESALE_LISTING', source_agreement_id: ag.id, status: 'DRAFT' });
      expect(body.draft.data.qty_kg).toBe('250.000');
      expect((await agreements.get(pool, ag.id))!.resale_reserved_kg).toBe('250.000');
    });
  });
});
