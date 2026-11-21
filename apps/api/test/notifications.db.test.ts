// Task 23.1: in-app notifications are created once per new match pair for the Dashboard side only,
// and each organization sees and changes only its own rows.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/domain/permissions.js';
import { createMatchingService, createNotificationService, type MatchingService, type NotificationService } from '../src/services/index.js';
import { formatKgTh } from '../src/services/matching/notify.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOrgWithUser } from './factories.js';

const NOW = new Date('2026-11-18T00:00:00Z');
const NEAR = { lat: '17.620000', lng: '100.100000' };

describe('formatKgTh', () => {
  it('groups digits with string math and drops trailing zeros', () => {
    expect(formatKgTh('5000.000')).toBe('5,000 กก.');
    expect(formatKgTh('1234567.500')).toBe('1,234,567.5 กก.');
    expect(formatKgTh('0.250')).toBe('0.25 กก.');
    expect(formatKgTh('abc')).toBe('');
  });
});

describe.skipIf(!testDatabaseUrl)('notifications (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let matching: MatchingService;
  let svc: NotificationService;
  const actorOf = (p: { org: { id: string }; user: { id: string } }, role: Actor['role']): Actor => ({
    userId: p.user.id, orgId: p.org.id, role, channel: 'web',
  });

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    matching = createMatchingService({ pool, now: () => NOW });
    svc = createNotificationService({ pool });
  });
  afterAll(async () => {
    await db?.close();
  });

  const recompute = async (entity_type: string, entity_id: string) => {
    const r = await matching.recompute({ entity_type, entity_id, version: 1 });
    if (!r.ok) throw new Error(`recompute failed ${r.error.code}`);
    return r.value;
  };
  const rowsOf = async (orgId: string) =>
    (await pool.query('SELECT * FROM notifications WHERE org_id = $1 ORDER BY created_at, id', [orgId])).rows;

  async function scene() {
    const farmer = await makeOrgWithUser(pool, 'FARMER');
    const factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    const other = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    const listing = await makeListing(pool, farmer.org.id, { ...NEAR, province: 'นครสวรรค์', qty: '5000.000' });
    const demand = await makeDemand(pool, factory.org.id, { ...NEAR });
    return { farmer, factory, other, listing, demand };
  }

  it('notifies the demand owner once per new pair, not the farmer, and never again on recompute', async () => {
    const s = await scene();
    await recompute('LISTING', s.listing.id);
    const rows = await rowsOf(s.factory.org.id);
    expect(rows).toHaveLength(1);
    const match = (await pool.query('SELECT id FROM matches WHERE supply_id = $1 AND demand_id = $2', [s.listing.id, s.demand.id])).rows[0];
    expect(rows[0]).toMatchObject({
      kind: 'NEW_MATCH', route: 1, supply_id: s.listing.id, demand_id: s.demand.id,
      title_th: 'มีประกาศใหม่ตรงกับความต้องการของคุณ', body_th: 'ฟางข้าว 5,000 กก. · นครสวรรค์', link_path: `/matches/${match.id}`, read_at: null,
    });
    expect(await rowsOf(s.farmer.org.id)).toHaveLength(0);
    // The text carries no farmer identity or contact data.
    expect(JSON.stringify(rows[0])).not.toContain(s.farmer.org.id);

    await recompute('LISTING', s.listing.id);
    await recompute('DEMAND', s.demand.id);
    expect(await rowsOf(s.factory.org.id)).toHaveLength(1);

    // Even if the pair disappears and returns, the unique key keeps it at one notification.
    await pool.query('DELETE FROM matches WHERE supply_id = $1', [s.listing.id]);
    await recompute('LISTING', s.listing.id);
    expect(await rowsOf(s.factory.org.id)).toHaveLength(1);
  });

  it('lists only own rows newest first, marks one read, and marks all read; other orgs cannot see or mark', async () => {
    const s = await scene();
    await recompute('LISTING', s.listing.id);
    const second = await makeListing(pool, s.farmer.org.id, { ...NEAR, province: 'อุตรดิตถ์', qty: '1200.000' });
    await recompute('LISTING', second.id);

    const mine = actorOf(s.factory, 'BUYER_FACTORY');
    const list = await svc.list(mine);
    if (!list.ok) throw new Error('list failed');
    expect(list.value.items).toHaveLength(2);
    expect(list.value.unread_count).toBe(2);
    expect(list.value.items[0]!.body_th).toContain('อุตรดิตถ์'); // newest first

    const otherActor = actorOf(s.other, 'BUYER_FACTORY');
    const otherList = await svc.list(otherActor);
    expect(otherList.ok && otherList.value).toEqual({ items: [], unread_count: 0 });
    const id = list.value.items[0]!.id;
    const denied = await svc.markRead(otherActor, id);
    expect(!denied.ok && denied.error.code).toBe('NOT_FOUND');
    expect((await rowsOf(s.factory.org.id)).every((r) => r.read_at === null)).toBe(true);
    // A farmer has no Dashboard.
    const farmerList = await svc.list(actorOf(s.farmer, 'FARMER'));
    expect(!farmerList.ok && farmerList.error.code).toBe('FORBIDDEN');

    const read = await svc.markRead(mine, id);
    expect(read.ok && read.value.unread_count).toBe(1);
    expect((await svc.markRead(mine, id)).ok).toBe(true); // idempotent
    const all = await svc.markAllRead(otherActor);
    expect(all.ok && all.value.unread_count).toBe(0);
    expect((await rowsOf(s.factory.org.id)).filter((r) => r.read_at === null)).toHaveLength(1); // other org's read-all changed nothing

    const mineAll = await svc.markAllRead(mine);
    expect(mineAll.ok && mineAll.value.unread_count).toBe(0);
    expect((await rowsOf(s.factory.org.id)).every((r) => r.read_at !== null)).toBe(true);
  });

  it('limits the list to 50 rows', async () => {
    const s = await scene();
    for (let i = 0; i < 52; i++) {
      await pool.query(
        `INSERT INTO notifications (org_id, kind, route, supply_id, demand_id, title_th, body_th, link_path)
         VALUES ($1,'NEW_MATCH',1,gen_random_uuid(),gen_random_uuid(),'t','b','/matches/x')`,
        [s.factory.org.id],
      );
    }
    const r = await svc.list(actorOf(s.factory, 'BUYER_FACTORY'));
    expect(r.ok && r.value.items.length).toBe(50);
    expect(r.ok && r.value.unread_count).toBe(52);
  });
});
