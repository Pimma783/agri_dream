import { createHash } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agreements, balingRequests, balingServices, demands, drafts, imageAssessments, ledger, listings,
  matches, media, offers, organizations, resaleAllocations, withTransaction,
} from '../src/repos/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';

describe.skipIf(!testDatabaseUrl)('business repositories (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let farmer: string;
  let factory: string;
  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    farmer = (await organizations.insert(pool, { kind: 'FARMER', name: 'repo-farmer' })).id;
    factory = (await organizations.insert(pool, { kind: 'BUYER_FACTORY', name: 'repo-factory' })).id;
  });
  afterAll(async () => {
    await db?.close();
  });

  it('drafts: jsonb round trip and optimistic version check', async () => {
    const d = await drafts.insert(pool, { org_id: farmer, kind: 'SALE_LISTING', data: { qty: ['5', 'ton'], nested: { a: 1 } } });
    expect(d.data).toEqual({ qty: ['5', 'ton'], nested: { a: 1 } });
    expect(d.version).toBe(1);
    const v2 = await drafts.update(pool, d.id, { status: 'AWAITING_REVIEW' }, { expectedVersion: 1 });
    expect(v2?.version).toBe(2);
    expect(await drafts.update(pool, d.id, { status: 'DRAFT' }, { expectedVersion: 1 })).toBeNull();
    expect((await drafts.listByOrgStatus(pool, farmer, 'AWAITING_REVIEW')).map((x) => x.id)).toContain(d.id);
  });

  it('listings, demands, baling services and requests keep numerics as strings', async () => {
    const l = await listings.insert(pool, {
      org_id: farmer, kind: 'SALE', material_type: 'RICE_STRAW', total_qty_kg: '5000.500', remaining_qty_kg: '5000.500',
      price_mode: 'FIXED', unit_price_thb: '1.2500', price_unit: 'KG', lat: '17.620000', lng: '100.100000', status: 'PUBLISHED',
    });
    expect(l.total_qty_kg).toBe('5000.500');
    expect(l.unit_price_thb).toBe('1.2500');
    expect((await listings.listPublished(pool, 'RICE_STRAW')).map((x) => x.id)).toContain(l.id);
    expect(await listings.listPublished(pool, 'CORN_COB').then((r) => r.map((x) => x.id))).not.toContain(l.id);
    expect((await listings.getForUpdate(pool, l.id))?.id).toBe(l.id);

    const dm = await demands.insert(pool, {
      org_id: factory, accepted_materials: ['RICE_STRAW', 'CORN_COB'], target_qty_kg: '20000.000', remaining_qty_kg: '20000.000',
      price_mode: 'NEGOTIABLE', quality: { moisture_max: 20 }, status: 'PUBLISHED',
    });
    expect(dm.accepted_materials).toEqual(['RICE_STRAW', 'CORN_COB']);
    expect(dm.quality).toEqual({ moisture_max: 20 });
    expect(dm.max_unit_price_thb).toBeNull();

    const bs = await balingServices.insert(pool, {
      org_id: factory, material_types: ['RICE_STRAW'], service_mode: 'BOTH', price_mode: 'FIXED', unit_price_thb: '0.5000',
      price_unit: 'BALE', status: 'PUBLISHED',
    });
    const br = await balingRequests.insert(pool, {
      org_id: farmer, material_type: 'RICE_STRAW', qty_kg: '3000.000', requested_mode: 'ON_SITE', status: 'PUBLISHED',
    });
    expect((await balingServices.listPublished(pool)).map((x) => x.id)).toContain(bs.id);
    expect((await balingRequests.listPublished(pool)).map((x) => x.id)).toContain(br.id);
  });

  it('offers, agreements, ledger and resale allocations', async () => {
    const l = await listings.insert(pool, {
      org_id: farmer, kind: 'SALE', material_type: 'RICE_STRAW', total_qty_kg: '1000.000', remaining_qty_kg: '1000.000',
      price_mode: 'NEGOTIABLE', status: 'PUBLISHED',
    });
    const dm = await demands.insert(pool, {
      org_id: factory, accepted_materials: ['RICE_STRAW'], target_qty_kg: '1000.000', remaining_qty_kg: '1000.000',
      price_mode: 'NEGOTIABLE', status: 'PUBLISHED',
    });
    const key = `k-${Date.now()}`;
    const o = await offers.insert(pool, {
      kind: 'PURCHASE', from_org_id: factory, to_org_id: farmer, listing_id: l.id, demand_id: dm.id, qty_kg: '400.000',
      transport_by: 'BUYER', expires_at: new Date(Date.now() + 86_400_000), status: 'PENDING', idempotency_key: key, ready_date: '2025-01-31',
    });
    expect(o.ready_date).toBe('2025-01-31');
    expect((await offers.getByIdempotencyKey(pool, factory, key))?.id).toBe(o.id);
    expect((await offers.listPendingForListing(pool, l.id)).map((x) => x.id)).toEqual([o.id]);
    expect(await offers.listExpired(pool, new Date(Date.now() + 2 * 86_400_000))).toEqual(expect.arrayContaining([expect.objectContaining({ id: o.id })]));

    const ag = await withTransaction(pool, async (tx) => {
      const a = await agreements.insertIfAbsent(tx, {
        kind: 'PURCHASE', offer_id: o.id, seller_org_id: farmer, buyer_org_id: factory, listing_id: l.id, demand_id: dm.id,
        qty_kg: '400.000', status: 'PURCHASE_CONFIRMED',
      });
      expect(a).not.toBeNull();
      expect(await agreements.insertIfAbsent(tx, { kind: 'PURCHASE', offer_id: o.id, seller_org_id: farmer, buyer_org_id: factory, listing_id: l.id, demand_id: dm.id, qty_kg: '400.000', status: 'PURCHASE_CONFIRMED' })).toBeNull();
      await offers.update(tx, o.id, { status: 'ACCEPTED' }, { expectedVersion: 1 });
      return a!;
    });
    expect((await agreements.getByOffer(pool, o.id))?.id).toBe(ag.id);
    expect((await agreements.update(pool, ag.id, { resale_reserved_kg: '100.000' }))?.version).toBe(2);

    const entry = { subject_type: 'LISTING' as const, subject_id: l.id, agreement_id: ag.id, entry_kind: 'COMMIT' as const, qty_kg: '400.000' };
    expect(await ledger.append(pool, entry)).not.toBeNull();
    expect(await ledger.append(pool, entry)).toBeNull(); // duplicate ignored
    expect(await ledger.netCommitted(pool, 'LISTING', l.id)).toBe('400.000');
    await expect(pool.query('UPDATE quantity_ledger SET qty_kg = 1')).rejects.toThrow(/append-only/);

    const draft = await drafts.insert(pool, { org_id: factory, kind: 'RESALE_LISTING', source_agreement_id: ag.id });
    const alloc = await resaleAllocations.insert(pool, { source_agreement_id: ag.id, draft_id: draft.id, qty_kg: '100.000', status: 'ACTIVE' });
    expect((await resaleAllocations.getByDraft(pool, draft.id))?.id).toBe(alloc.id);
    expect(await resaleAllocations.activeTotal(pool, ag.id)).toBe('100.000');
    await resaleAllocations.update(pool, alloc.id, { status: 'RELEASED' });
    expect(await resaleAllocations.activeTotal(pool, ag.id)).toBe('0');
  });

  it('media stores bytea content, metadata reads skip it, assessment upsert replaces', async () => {
    const d = await drafts.insert(pool, { org_id: farmer, kind: 'SALE_LISTING' });
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const m = await media.insertDb(pool, {
      org_id: farmer, owner_type: 'DRAFT', owner_id: d.id, content_type: 'image/jpeg', size_bytes: bytes.length, sha256: sha, content: bytes,
    });
    expect(m).not.toHaveProperty('content');
    const c = await media.getContent(pool, m.id);
    expect(c?.content.equals(bytes)).toBe(true);
    expect((await media.getByOwnerHash(pool, 'DRAFT', d.id, sha))?.id).toBe(m.id);

    const a1 = await imageAssessments.upsert(pool, { media_id: m.id, status: 'UNAVAILABLE', error_code: 'AI_DISABLED' });
    expect(a1?.status).toBe('UNAVAILABLE');
    const a2 = await imageAssessments.upsert(pool, { media_id: m.id, status: 'OK', result: { moisture: 'low' }, model_id: 'x' });
    expect(a2?.id).toBe(a1?.id);
    expect(a2?.result).toEqual({ moisture: 'low' });
  });

  it('matches: upsert keeps one row per (route, supply, demand, rule_version)', async () => {
    const s = (await organizations.insert(pool, { kind: 'FARMER', name: 'm-s' })).id;
    const base = { route: 1, supply_id: s, demand_id: factory, rule_version: 'v1', score: '71.50', tier: 1 as const, reasons: ['ok'] };
    const m1 = await matches.upsert(pool, base);
    const m2 = await matches.upsert(pool, { ...base, score: '80.25', distance_km: '12.40' });
    expect(m2?.id).toBe(m1?.id);
    expect(m2?.score).toBe('80.25');
    expect(m2?.reasons).toEqual(['ok']);
    expect((await matches.listBySupply(pool, s)).length).toBe(1);
  });
});
