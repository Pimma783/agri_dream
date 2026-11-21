import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec, lockRows, many, offers, withTransaction } from '../src/repos/index.js';
import { z } from 'zod';
import { createTestDb, runConcurrentTransactions, runConcurrently, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeMarket, makeOrg } from './factories.js';

const countOrgs = async (db: pg.Pool | pg.PoolClient) =>
  (await many(db, z.object({ n: z.coerce.number() }), 'SELECT count(*)::int AS n FROM organizations'))[0]?.n;

describe.skipIf(!testDatabaseUrl)('DB test harness (real Postgres)', () => {
  let a: TestDb;
  let b: TestDb;
  beforeAll(async () => {
    a = await createTestDb({ max: 6 });
    b = await createTestDb();
  });
  afterAll(async () => {
    await a?.close();
    await b?.close();
  });

  it('migrates a private schema per harness and isolates data between them', async () => {
    expect(a.schema).not.toBe(b.schema);
    await makeOrg(a.pool);
    expect(await countOrgs(a.pool)).toBe(1);
    expect(await countOrgs(b.pool)).toBe(0);
  });

  it('withRollback leaves nothing behind, even after a thrown error', async () => {
    const before = await countOrgs(a.pool);
    await a.withRollback(async (tx) => {
      await makeOrg(tx);
      expect(await countOrgs(tx)).toBe(before! + 1);
    });
    await expect(a.withRollback(async (tx) => { await makeOrg(tx); throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await countOrgs(a.pool)).toBe(before);
  });

  it('resetData rebuilds the schema even with append-only ledger and audit rows, without touching another harness', async () => {
    const m = await makeMarket(a.pool);
    const ag = await a.pool.query<{ id: string }>(
      `INSERT INTO agreements (kind, offer_id, seller_org_id, buyer_org_id, listing_id, demand_id, qty_kg, status)
       VALUES ('PURCHASE',$1,$2,$3,$4,$5,10,'PURCHASE_CONFIRMED') RETURNING id`,
      [m.offer.id, m.farmer.org.id, m.factory.org.id, m.listing.id, m.demand.id],
    );
    await a.pool.query(
      `INSERT INTO quantity_ledger (subject_type, subject_id, agreement_id, entry_kind, qty_kg) VALUES ('LISTING', $1, $2, 'COMMIT', 10)`,
      [m.listing.id, ag.rows[0]!.id],
    );
    // the protection stays on: the ledger cannot be truncated, so isolation must not rely on that
    await expect(a.pool.query('TRUNCATE quantity_ledger')).rejects.toThrow(/append-only/);
    const ledgerCount = async (db: pg.Pool) => (await db.query('SELECT count(*)::int AS n FROM quantity_ledger')).rows[0].n;
    expect(await ledgerCount(a.pool)).toBe(1);
    await makeOrg(b.pool);

    await a.resetData();

    expect(await countOrgs(a.pool)).toBe(0);
    expect(await ledgerCount(a.pool)).toBe(0);
    expect(await countOrgs(b.pool)).toBeGreaterThan(0);
    // append-only triggers are still installed after the rebuild
    const m2 = await makeMarket(a.pool);
    expect(m2.offer.status).toBe('PENDING');
    await expect(a.pool.query('TRUNCATE quantity_ledger')).rejects.toThrow(/append-only/);
  });

  it('factories create non-demo, synthetic rows with decimal strings', async () => {
    const m = await makeMarket(a.pool);
    for (const row of [m.farmer.org, m.farmer.user, m.factory.org, m.listing, m.demand, m.offer]) expect(row.is_demo).toBe(false);
    expect(m.farmer.org.name).toMatch(/^synthetic-/);
    expect(m.listing.total_qty_kg).toBe('10000.000');
    expect(m.offer.qty_kg).toBe('1000.000');
  });

  it('runConcurrentTransactions uses distinct connections that overlap, and settles winners and losers', async () => {
    const m = await makeMarket(a.pool);
    const results = await runConcurrentTransactions(a.url, 4, async (tx, i) => {
      const pid = (await tx.query<{ p: number }>('SELECT pg_backend_pid() AS p')).rows[0]!.p;
      // all four hold their transaction open here; only one may take the row lock first
      await tx.query('SELECT id FROM offers WHERE id = $1 FOR UPDATE', [m.offer.id]);
      const { rowCount } = await tx.query(`UPDATE offers SET status = 'ACCEPTED' WHERE id = $1 AND status = 'PENDING'`, [m.offer.id]);
      if (rowCount !== 1) throw new Error(`lost:${i}`);
      return pid;
    });
    const ok = results.filter((r): r is PromiseFulfilledResult<number> => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);
    expect((await offers.get(a.pool, m.offer.id))?.status).toBe('ACCEPTED');
  });

  it('runConcurrentTransactions rolls back a failing callback', async () => {
    const before = await countOrgs(a.pool);
    const r = await runConcurrentTransactions(a.url, 2, async (tx, i) => {
      await tx.query(`INSERT INTO organizations (kind, name) VALUES ('FARMER', $1)`, [`synthetic-conc-${i}`]);
      if (i === 1) throw new Error('fail');
    });
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'rejected']);
    expect(await countOrgs(a.pool)).toBe(before! + 1);
  });

  it('runConcurrently drives service-style withTransaction calls through the pool', async () => {
    const m = await makeMarket(a.pool);
    const r = await runConcurrently(3, (i) =>
      withTransaction(a.pool, async (tx) => {
        await lockRows(tx, [{ table: 'offers', id: m.offer.id }]);
        const n = await exec(tx, `UPDATE offers SET status = 'WITHDRAWN' WHERE id = $1 AND status = 'PENDING'`, [m.offer.id]);
        if (n !== 1) throw new Error(`lost:${i}`);
      }),
    );
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });

  it('refuses a runner pointed at a non-test database', async () => {
    await expect(runConcurrentTransactions('postgres://u:p@127.0.0.1:5433/agrimatch', 1, async () => 1)).rejects.toThrow(/agrimatch_test/);
  });
});
