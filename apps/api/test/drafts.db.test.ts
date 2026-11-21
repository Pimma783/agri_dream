import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor, Channel, Role } from '../src/domain/permissions.js';
import {
  appError, createBalingRequestService, createBalingServiceService, createDemandService, createDraftService,
  createListingService, err, type DraftService, type DraftView, type Result,
} from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeOrgWithUser } from './factories.js';

type OrgKind = Role;

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`unexpected error ${r.error.code}`);
  return r.value;
}

describe.skipIf(!testDatabaseUrl)('draft, listing, demand and baling services (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let drafts: DraftService;
  let listings: ReturnType<typeof createListingService>;
  let demands: ReturnType<typeof createDemandService>;
  let services: ReturnType<typeof createBalingServiceService>;
  let requests: ReturnType<typeof createBalingRequestService>;

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    const ctx = { pool };
    drafts = createDraftService(ctx);
    listings = createListingService(ctx);
    demands = createDemandService(ctx);
    services = createBalingServiceService(ctx);
    requests = createBalingRequestService(ctx);
  });
  afterAll(async () => {
    await db?.close();
  });

  async function actorOf(role: OrgKind, channel: Channel = 'web'): Promise<Actor> {
    const { org, user } = await makeOrgWithUser(pool, role);
    return { userId: user.id, orgId: org.id, role, channel };
  }
  const asChannel = (a: Actor, channel: Channel): Actor => ({ ...a, channel });
  const count = async (sql: string, params: unknown[]) => Number((await pool.query(sql, params)).rows[0].count);

  const SALE = {
    material_type: 'RICE_STRAW', quantity: { value: '5', unit: 'ton' },
    price_mode: 'FIXED', price: { value: '1.25', unit: 'kg' }, province: 'Uttaradit',
  } as const;

  async function awaitingSale(farmer: Actor, patch: object = SALE): Promise<DraftView> {
    return unwrap(await drafts.create(farmer, { kind: 'SALE_LISTING', patch }));
  }

  describe('draft create and patch', () => {
    it('stays DRAFT while incomplete, moves to AWAITING_REVIEW when complete, and lists missing fields', async () => {
      const farmer = await actorOf('FARMER');
      const d = unwrap(await drafts.create(farmer, { kind: 'SALE_LISTING', patch: { material_type: 'RICE_STRAW' } }));
      expect(d.draft).toMatchObject({ status: 'DRAFT', version: 1, org_id: farmer.orgId, created_by: farmer.userId });
      expect(d.missing_fields.sort()).toEqual(['price_mode', 'province', 'qty_kg']);

      const p = unwrap(await drafts.patch(farmer, { draftId: d.draft.id, expectedVersion: 1, patch: { quantity: { value: '5', unit: 'ton' }, price_mode: 'NEGOTIABLE', province: 'Uttaradit' } }));
      expect(p.draft).toMatchObject({ status: 'AWAITING_REVIEW', version: 2 });
      expect(p.draft.data).toMatchObject({ qty_kg: '5000.000', price_mode: 'NEGOTIABLE' });
      expect(p.complete).toBe(true);
    });

    it('a material edit of an AWAITING_REVIEW draft bumps the version and needs confirmation again', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      expect(d.draft.status).toBe('AWAITING_REVIEW');
      // incomplete after edit: back to DRAFT
      const e = unwrap(await drafts.patch(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version, patch: { material_type: 'CORN_COB' } }));
      expect(e.draft.version).toBe(d.draft.version + 1);
      expect(e.draft.status).toBe('AWAITING_REVIEW'); // still complete, so it returns to review at the new version
      // the old version can no longer publish
      expect(await drafts.publish(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version })).toEqual(
        err(appError('STALE_VERSION', { details: { current_version: e.draft.version } })),
      );
    });

    it('rejects a stale patch and leaves the data untouched', async () => {
      const farmer = await actorOf('FARMER');
      const d1 = await awaitingSale(farmer);
      const d = unwrap(await drafts.patch(farmer, { draftId: d1.draft.id, expectedVersion: d1.draft.version, patch: { province: 'Phrae' } }));
      const r = await drafts.patch(farmer, { draftId: d.draft.id, expectedVersion: d1.draft.version, patch: { province: 'Elsewhere' } });
      expect(r).toEqual(err(appError('STALE_VERSION', { details: { current_version: d.draft.version } })));
      expect(unwrap(await drafts.get(farmer, d.draft.id)).draft.data).toMatchObject({ province: 'Phrae' });
    });

    it('a patch that changes nothing keeps the version', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      const same = unwrap(await drafts.patch(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version, patch: { province: 'Uttaradit' } }));
      expect(same.draft.version).toBe(d.draft.version);
    });

    it('asks for confirmation of local units and refuses assistant-forged status fields', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      const unit = await drafts.patch(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version, patch: { quantity: { value: '2', unit: 'เกวียน' } } });
      expect(!unit.ok && unit.error.code).toBe('VALIDATION');
      const forged = await drafts.patch(asChannel(farmer, 'assistant'), { draftId: d.draft.id, expectedVersion: d.draft.version, patch: { status: 'PUBLISHED' } });
      expect(!forged.ok && forged.error.code).toBe('VALIDATION');
      expect(unwrap(await drafts.get(farmer, d.draft.id)).draft).toMatchObject({ status: 'AWAITING_REVIEW', version: d.draft.version });
    });

    it('the assistant can create and patch drafts', async () => {
      const farmer = await actorOf('FARMER', 'assistant');
      const d = unwrap(await drafts.create(farmer, { kind: 'SALE_LISTING', patch: { material_type: 'CANE_LEAF' } }));
      const p = unwrap(await drafts.patch(farmer, { draftId: d.draft.id, expectedVersion: 1, patch: { province: 'Nakhon Sawan' } }));
      expect(p.draft.version).toBe(2);
    });

    it('cancel moves to CANCELLED, and a cancelled draft cannot be patched or published', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      const c = unwrap(await drafts.cancel(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version }));
      expect(c.draft.status).toBe('CANCELLED');
      const p = await drafts.patch(farmer, { draftId: d.draft.id, expectedVersion: c.draft.version, patch: { province: 'X' } });
      expect(!p.ok && p.error.code).toBe('INVALID_STATE');
      const pub = await drafts.publish(farmer, { draftId: d.draft.id, expectedVersion: c.draft.version });
      expect(!pub.ok && pub.error.code).toBe('INVALID_STATE');
    });

    it('refuses to start a resale draft here (it needs a source agreement)', async () => {
      const baler = await actorOf('BALER');
      const r = await drafts.create(baler, { kind: 'RESALE_LISTING' });
      expect(!r.ok && r.error.code).toBe('VALIDATION');
    });
  });

  describe('permissions', () => {
    it('role violations are FORBIDDEN and write nothing', async () => {
      const factory = await actorOf('BUYER_FACTORY');
      const farmer = await actorOf('FARMER');
      const before = await count('SELECT count(*) FROM drafts', []);
      for (const [actor, kind] of [
        [factory, 'SALE_LISTING'], [factory, 'BALING_SERVICE'], [farmer, 'PURCHASE_DEMAND'], [farmer, 'BALING_SERVICE'], [factory, 'BALING_REQUEST'],
      ] as const) {
        const r = await drafts.create(actor, { kind });
        expect(!r.ok && r.error.code).toBe('FORBIDDEN');
      }
      expect(await count('SELECT count(*) FROM drafts', [])).toBe(before);
    });

    it('another organization sees a draft exactly as a missing one', async () => {
      const farmer = await actorOf('FARMER');
      const other = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      const missing = '00000000-0000-4000-8000-000000000000';
      const notFound = err(appError('NOT_FOUND'));
      expect(await drafts.get(other, d.draft.id)).toEqual(notFound);
      expect(await drafts.get(other, missing)).toEqual(notFound);
      expect(await drafts.patch(other, { draftId: d.draft.id, expectedVersion: 1, patch: { province: 'X' } })).toEqual(notFound);
      expect(await drafts.publish(other, { draftId: d.draft.id, expectedVersion: d.draft.version })).toEqual(notFound);
      expect(await drafts.cancel(other, { draftId: d.draft.id, expectedVersion: d.draft.version })).toEqual(notFound);
      // even a wrong-role actor from another org learns nothing
      const factory = await actorOf('BUYER_FACTORY');
      expect(await drafts.publish(factory, { draftId: d.draft.id, expectedVersion: d.draft.version })).toEqual(notFound);
    });

    it('list returns only the own organization drafts', async () => {
      const a = await actorOf('FARMER');
      const b = await actorOf('FARMER');
      await awaitingSale(a);
      await awaitingSale(b);
      const mine = unwrap(await drafts.list(a));
      expect(mine).toHaveLength(1);
      expect(mine[0]?.draft.org_id).toBe(a.orgId);
    });
  });

  describe('publish', () => {
    it('creates one listing from the confirmed version: kg decimals, no invented coordinates, job and audit', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      const r = unwrap(await drafts.publish(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version }));
      expect(r).toMatchObject({ entity_type: 'LISTING', draft_version: d.draft.version, replayed: false });

      const row = (await pool.query('SELECT * FROM material_listings WHERE id = $1', [r.entity_id])).rows[0];
      expect(row).toMatchObject({
        org_id: farmer.orgId, kind: 'SALE', material_type: 'RICE_STRAW', status: 'PUBLISHED', version: 1,
        total_qty_kg: '5000.000', committed_qty_kg: '0.000', remaining_qty_kg: '5000.000',
        price_mode: 'FIXED', unit_price_thb: '1.2500', price_unit: 'KG', province: 'อุตรดิตถ์', // stored in the canonical Thai form (input was 'Uttaradit')
        lat: null, lng: null, source_draft_id: d.draft.id,
      });
      const draft = unwrap(await drafts.get(farmer, d.draft.id)).draft;
      expect(draft).toMatchObject({ status: 'PUBLISHED', published_entity_type: 'LISTING', published_entity_id: r.entity_id, version: d.draft.version });

      const job = (await pool.query(`SELECT payload FROM jobs WHERE kind = 'recompute_matches' AND payload->>'entity_id' = $1`, [r.entity_id])).rows;
      expect(job).toHaveLength(1);
      expect(job[0].payload).toMatchObject({ entity_type: 'LISTING', version: 1 });
      const log = (await pool.query(`SELECT actor_org_id, channel, entity_version FROM audit_logs WHERE action = 'draft.published' AND entity_id = $1`, [d.draft.id])).rows;
      expect(log).toEqual([{ actor_org_id: farmer.orgId, channel: 'web', entity_version: d.draft.version }]);
    });

    it('stores coordinates only when the user sent both', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer, { ...SALE, lat: 17.62, lng: 100.1 });
      const r = unwrap(await drafts.publish(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version }));
      const row = (await pool.query('SELECT lat, lng FROM material_listings WHERE id = $1', [r.entity_id])).rows[0];
      expect(row).toEqual({ lat: '17.620000', lng: '100.100000' });
      const half = await drafts.patch(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version, patch: { lat: 17 } });
      expect(!half.ok).toBe(true);
    });

    it('NEGOTIABLE is stored as a NULL price, not 0', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer, { ...SALE, price_mode: 'NEGOTIABLE', price: undefined });
      const r = unwrap(await drafts.publish(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version }));
      const row = (await pool.query('SELECT price_mode, unit_price_thb, price_unit FROM material_listings WHERE id = $1', [r.entity_id])).rows[0];
      expect(row).toEqual({ price_mode: 'NEGOTIABLE', unit_price_thb: null, price_unit: null });
    });

    it('a stale version creates nothing', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      const e = unwrap(await drafts.patch(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version, patch: { province: 'Phrae' } }));
      const r = await drafts.publish(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version });
      expect(!r.ok && r.error.code).toBe('STALE_VERSION');
      expect(await count('SELECT count(*) FROM material_listings WHERE source_draft_id = $1', [d.draft.id])).toBe(0);
      expect(unwrap(await drafts.get(farmer, d.draft.id)).draft.status).toBe('AWAITING_REVIEW');
      expect(e.draft.version).toBe(d.draft.version + 1);
    });

    it('an incomplete draft cannot be published and the missing fields are reported', async () => {
      const farmer = await actorOf('FARMER');
      const d = unwrap(await drafts.create(farmer, { kind: 'SALE_LISTING', patch: { material_type: 'RICE_STRAW' } }));
      const r = await drafts.publish(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version });
      expect(!r.ok && r.error.code).toBe('VALIDATION');
      expect(!r.ok && r.error.fields?.map((f) => f.path).sort()).toEqual(['price_mode', 'province', 'qty_kg']);
      expect(await count('SELECT count(*) FROM material_listings WHERE source_draft_id = $1', [d.draft.id])).toBe(0);
    });

    it('the assistant can never publish', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      const r = await drafts.publish(asChannel(farmer, 'assistant'), { draftId: d.draft.id, expectedVersion: d.draft.version });
      expect(r).toEqual(err(appError('FORBIDDEN')));
      expect(unwrap(await drafts.get(farmer, d.draft.id)).draft.status).toBe('AWAITING_REVIEW');
      expect(await count('SELECT count(*) FROM material_listings WHERE source_draft_id = $1', [d.draft.id])).toBe(0);
    });

    it('publishing the same version twice returns the same entity and one row', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      const input = { draftId: d.draft.id, expectedVersion: d.draft.version };
      const first = unwrap(await drafts.publish(farmer, input));
      const second = unwrap(await drafts.publish(farmer, input));
      expect(second).toMatchObject({ entity_id: first.entity_id, replayed: true });
      expect(await count('SELECT count(*) FROM material_listings WHERE source_draft_id = $1', [d.draft.id])).toBe(1);
      expect(await count(`SELECT count(*) FROM audit_logs WHERE action = 'draft.published' AND entity_id = $1`, [d.draft.id])).toBe(1);
      // a different version of the published draft is stale
      const stale = await drafts.publish(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version + 1 });
      expect(!stale.ok && stale.error.code).toBe('STALE_VERSION');
    });

    it('Idempotency-Key replays the stored result and rejects a different request', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      const input = { draftId: d.draft.id, expectedVersion: d.draft.version, idempotencyKey: 'key-1' };
      const first = unwrap(await drafts.publish(farmer, input));
      expect(first.replayed).toBe(false);
      const again = unwrap(await drafts.publish(farmer, input));
      expect(again).toMatchObject({ entity_id: first.entity_id, replayed: true });
      const mismatch = await drafts.publish(farmer, { ...input, expectedVersion: d.draft.version + 1 });
      expect(mismatch).toEqual(err(appError('IDEMPOTENCY_MISMATCH')));
      expect(await count('SELECT count(*) FROM material_listings WHERE source_draft_id = $1', [d.draft.id])).toBe(1);
      const bad = await drafts.publish(farmer, { ...input, idempotencyKey: '' });
      expect(!bad.ok && bad.error.code).toBe('VALIDATION');
    });

    it('concurrent confirmations of one version create one row', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          drafts.publish(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version, ...(i % 2 ? { idempotencyKey: `k${i}` } : {}) }),
        ),
      );
      const ids = new Set(results.map((r) => unwrap(r).entity_id));
      expect(ids.size).toBe(1);
      expect(await count('SELECT count(*) FROM material_listings WHERE source_draft_id = $1', [d.draft.id])).toBe(1);
      expect(await count(`SELECT count(*) FROM jobs WHERE kind = 'recompute_matches' AND payload->>'entity_id' = $1`, [[...ids][0]])).toBe(1);
    });

    it('an OTHER material publishes (matching leaves it out)', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer, { ...SALE, material_type: 'OTHER' });
      const r = unwrap(await drafts.publish(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version }));
      expect((await pool.query('SELECT material_type FROM material_listings WHERE id = $1', [r.entity_id])).rows[0].material_type).toBe('OTHER');
    });

    it('creates a demand for a factory and for a baler, kept apart from baling services', async () => {
      const demand = { accepted_materials: ['RICE_STRAW', 'CORN_COB'], target_quantity: { value: '50', unit: 'ton' }, min_lot: { value: '5', unit: 'ton' }, price_mode: 'FIXED', price: { value: '2', unit: 'kg' }, province: 'Nakhon Sawan', radius_km: '60' } as const;
      for (const role of ['BUYER_FACTORY', 'BALER'] as const) {
        const actor = await actorOf(role);
        const d = unwrap(await drafts.create(actor, { kind: 'PURCHASE_DEMAND', patch: demand }));
        expect(d.draft.status).toBe('AWAITING_REVIEW');
        const r = unwrap(await drafts.publish(actor, { draftId: d.draft.id, expectedVersion: d.draft.version }));
        expect(r.entity_type).toBe('DEMAND');
        const row = (await pool.query('SELECT * FROM purchase_demands WHERE id = $1', [r.entity_id])).rows[0];
        expect(row).toMatchObject({
          org_id: actor.orgId, target_qty_kg: '50000.000', remaining_qty_kg: '50000.000', min_lot_kg: '5000.000',
          max_unit_price_thb: '2.0000', price_unit: 'KG', radius_km: '60.00', status: 'PUBLISHED', lat: null,
        });
        expect(row.accepted_materials).toEqual(['RICE_STRAW', 'CORN_COB']);
        expect(await count('SELECT count(*) FROM baling_services WHERE org_id = $1', [actor.orgId])).toBe(0);
      }
    });

    it('creates a baling service (BALER) and a baling request (FARMER)', async () => {
      const baler = await actorOf('BALER');
      const s = unwrap(await drafts.create(baler, {
        kind: 'BALING_SERVICE',
        patch: { material_types: ['RICE_STRAW'], service_mode: 'BOTH', price_mode: 'FIXED', price: { value: '80', unit: 'bale' }, province: 'Kamphaeng Phet', service_provinces: ['Kamphaeng Phet', 'Nakhon Sawan'], min_quantity: { value: '2', unit: 'ton' } },
      }));
      const sr = unwrap(await drafts.publish(baler, { draftId: s.draft.id, expectedVersion: s.draft.version }));
      expect(sr.entity_type).toBe('BALING_SERVICE');
      expect((await pool.query('SELECT * FROM baling_services WHERE id = $1', [sr.entity_id])).rows[0]).toMatchObject({
        org_id: baler.orgId, price_unit: 'BALE', unit_price_thb: '80.0000', min_qty_kg: '2000.000', status: 'PUBLISHED',
      });

      const farmer = await actorOf('FARMER');
      const q = unwrap(await drafts.create(farmer, {
        kind: 'BALING_REQUEST', patch: { material_type: 'RICE_STRAW', quantity: { value: '3000', unit: 'kg' }, requested_mode: 'ON_SITE', province: 'Uttaradit' },
      }));
      const qr = unwrap(await drafts.publish(farmer, { draftId: q.draft.id, expectedVersion: q.draft.version }));
      expect(qr.entity_type).toBe('BALING_REQUEST');
      expect((await pool.query('SELECT * FROM baling_requests WHERE id = $1', [qr.entity_id])).rows[0]).toMatchObject({
        org_id: farmer.orgId, qty_kg: '3000.000', requested_mode: 'ON_SITE', status: 'PUBLISHED',
      });
      // a request needs no sale and no listing exists for it (Requirement 7.6)
      expect(await count('SELECT count(*) FROM material_listings WHERE org_id = $1', [farmer.orgId])).toBe(0);
    });

    it('rolls back everything when the entity cannot be written', async () => {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      // The unique source_draft_id backstop: a listing already exists for this draft id.
      await pool.query(
        `INSERT INTO material_listings (org_id, kind, material_type, total_qty_kg, remaining_qty_kg, price_mode, status, source_draft_id)
         VALUES ($1,'SALE','RICE_STRAW',1,1,'NEGOTIABLE','PUBLISHED',$2)`,
        [farmer.orgId, d.draft.id],
      );
      await expect(drafts.publish(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version })).rejects.toThrow();
      expect(unwrap(await drafts.get(farmer, d.draft.id)).draft.status).toBe('AWAITING_REVIEW');
      expect(await count(`SELECT count(*) FROM audit_logs WHERE action = 'draft.published' AND entity_id = $1`, [d.draft.id])).toBe(0);
    });
  });

  describe('published entity lifecycle', () => {
    async function publishedListing() {
      const farmer = await actorOf('FARMER');
      const d = await awaitingSale(farmer);
      const r = unwrap(await drafts.publish(farmer, { draftId: d.draft.id, expectedVersion: d.draft.version }));
      return { farmer, id: r.entity_id };
    }

    it('pause, open and close bump the version, write audit rows and enqueue a recompute each time', async () => {
      const { farmer, id } = await publishedListing();
      const paused = unwrap(await listings.pause(farmer, { id, expectedVersion: 1 }));
      expect(paused).toMatchObject({ status: 'PAUSED', version: 2 });
      const opened = unwrap(await listings.open(farmer, { id, expectedVersion: 2 }));
      expect(opened).toMatchObject({ status: 'PUBLISHED', version: 3 });
      const closed = unwrap(await listings.close(farmer, { id, expectedVersion: 3 }));
      expect(closed).toMatchObject({ status: 'CLOSED', version: 4 });
      const actions = (await pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [id])).rows.map((r) => r.action);
      expect(actions).toEqual(['listing.paused', 'listing.opened', 'listing.closed']);
      expect(await count(`SELECT count(*) FROM jobs WHERE kind = 'recompute_matches' AND payload->>'entity_id' = $1`, [id])).toBe(4);
    });

    it('rejects a move outside the state table, a stale version, and any change by the assistant', async () => {
      const { farmer, id } = await publishedListing();
      const stale = await listings.pause(farmer, { id, expectedVersion: 5 });
      expect(stale).toEqual(err(appError('STALE_VERSION', { details: { current_version: 1 } })));
      const reopen = await listings.open(farmer, { id, expectedVersion: 1 });
      expect(reopen).toEqual(err(appError('INVALID_STATE', { details: { state: 'PUBLISHED' } })));
      const bot = await listings.close(asChannel(farmer, 'assistant'), { id, expectedVersion: 1 });
      expect(bot).toEqual(err(appError('FORBIDDEN')));
      unwrap(await listings.close(farmer, { id, expectedVersion: 1 }));
      const after = await listings.cancel(farmer, { id, expectedVersion: 2 });
      expect(!after.ok && after.error.code).toBe('INVALID_STATE');
    });

    it('another organization or role gets NOT_FOUND or FORBIDDEN and nothing changes', async () => {
      const { farmer, id } = await publishedListing();
      const other = await actorOf('FARMER');
      const factory = await actorOf('BUYER_FACTORY');
      const notFound = err(appError('NOT_FOUND'));
      expect(await listings.pause(other, { id, expectedVersion: 1 })).toEqual(notFound);
      expect(await listings.get(other, id)).toEqual(notFound);
      expect(await listings.get(other, '00000000-0000-4000-8000-000000000000')).toEqual(notFound);
      expect(await listings.pause(factory, { id, expectedVersion: 1 })).toEqual(err(appError('FORBIDDEN')));
      expect(unwrap(await listings.get(farmer, id)).status).toBe('PUBLISHED');
      expect(unwrap(await listings.list(other))).toEqual([]);
    });

    it('works for demands, baling services and baling requests with their own capability', async () => {
      const factory = await actorOf('BUYER_FACTORY');
      const dd = unwrap(await drafts.create(factory, { kind: 'PURCHASE_DEMAND', patch: { accepted_materials: ['RICE_STRAW'], target_quantity: { value: '10', unit: 'ton' }, price_mode: 'NEGOTIABLE', province: 'Uttaradit' } }));
      const demand = unwrap(await drafts.publish(factory, { draftId: dd.draft.id, expectedVersion: dd.draft.version }));
      expect(unwrap(await demands.pause(factory, { id: demand.entity_id, expectedVersion: 1 })).status).toBe('PAUSED');
      expect(unwrap(await demands.open(factory, { id: demand.entity_id, expectedVersion: 2 })).status).toBe('PUBLISHED');

      const baler = await actorOf('BALER');
      const sd = unwrap(await drafts.create(baler, { kind: 'BALING_SERVICE', patch: { material_types: ['RICE_STRAW'], service_mode: 'ON_SITE', price_mode: 'NEGOTIABLE', province: 'Uttaradit' } }));
      const svc = unwrap(await drafts.publish(baler, { draftId: sd.draft.id, expectedVersion: sd.draft.version }));
      expect(unwrap(await services.close(baler, { id: svc.entity_id, expectedVersion: 1 })).status).toBe('CLOSED');
      expect(await services.close(factory, { id: svc.entity_id, expectedVersion: 2 })).toEqual(err(appError('FORBIDDEN')));

      const farmer = await actorOf('FARMER');
      const other = await actorOf('FARMER');
      const rd = unwrap(await drafts.create(farmer, { kind: 'BALING_REQUEST', patch: { material_type: 'CORN_COB', quantity: { value: '1', unit: 'ton' }, requested_mode: 'AT_FACTORY', province: 'Uttaradit' } }));
      const req = unwrap(await drafts.publish(farmer, { draftId: rd.draft.id, expectedVersion: rd.draft.version }));
      // BALING_REQUEST_SUBMIT has no resource rule, so ownership is checked by the service
      expect(await requests.cancel(other, { id: req.entity_id, expectedVersion: 1 })).toEqual(err(appError('NOT_FOUND')));
      expect(unwrap(await requests.cancel(farmer, { id: req.entity_id, expectedVersion: 1 })).status).toBe('CANCELLED');
      const types = (await pool.query(`SELECT DISTINCT payload->>'entity_type' AS t FROM jobs WHERE kind = 'recompute_matches'`)).rows.map((r) => r.t);
      expect(types).toEqual(expect.arrayContaining(['DEMAND', 'BALING_SERVICE', 'BALING_REQUEST']));
    });
  });
});
