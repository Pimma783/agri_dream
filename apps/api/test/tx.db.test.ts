import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec, lockRows, many, organizations, sortLockTargets, withTransaction } from '../src/repos/index.js';
import { z } from 'zod';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';

describe('sortLockTargets', () => {
  it('orders by table name, then id', () => {
    const sorted = sortLockTargets([
      { table: 'offers', id: 'b' },
      { table: 'agreements', id: 'z' },
      { table: 'offers', id: 'a' },
    ]);
    expect(sorted.map((t) => `${t.table}:${t.id}`)).toEqual(['agreements:z', 'offers:a', 'offers:b']);
  });
});

describe.skipIf(!testDatabaseUrl)('withTransaction and lockRows (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  beforeAll(async () => {
    db = await createTestDb({ max: 6 });
    pool = db.pool;
  });
  afterAll(async () => {
    await db?.close();
  });
  const count = async (name: string) =>
    (await many(pool, z.object({ n: z.coerce.number() }), 'SELECT count(*)::int AS n FROM organizations WHERE name = $1', [name]))[0]?.n;
  const noWait = { backoffMs: () => 0 };

  it('commits when the function returns', async () => {
    const name = `tx-commit-${Date.now()}`;
    await withTransaction(pool, (tx) => organizations.insert(tx, { kind: 'FARMER', name }));
    expect(await count(name)).toBe(1);
  });

  it('rolls back when the function throws and does not retry a plain error', async () => {
    const name = `tx-rollback-${Date.now()}`;
    let calls = 0;
    await expect(
      withTransaction(pool, async (tx) => {
        calls++;
        await organizations.insert(tx, { kind: 'FARMER', name });
        throw new Error('boom');
      }, noWait),
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);
    expect(await count(name)).toBe(0);
  });

  it('retries a serialization failure (40001) and then succeeds', async () => {
    const name = `tx-retry-${Date.now()}`;
    let calls = 0;
    const retries: number[] = [];
    await withTransaction(
      pool,
      async (tx) => {
        calls++;
        await organizations.insert(tx, { kind: 'FARMER', name });
        if (calls < 3) throw Object.assign(new Error('serialization'), { code: '40001' });
      },
      { ...noWait, onRetry: (n) => retries.push(n) },
    );
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
    expect(await count(name)).toBe(1); // earlier attempts were rolled back
  });

  it('gives up after 3 retries (4 attempts) and rethrows', async () => {
    let calls = 0;
    await expect(
      withTransaction(pool, async () => {
        calls++;
        throw Object.assign(new Error('deadlock'), { code: '40P01' });
      }, noWait),
    ).rejects.toMatchObject({ code: '40P01' });
    expect(calls).toBe(4);
  });

  it('retries a real deadlock and both transactions finish', async () => {
    const [a, b] = await Promise.all([
      organizations.insert(pool, { kind: 'FARMER', name: 'dl-a' }),
      organizations.insert(pool, { kind: 'FARMER', name: 'dl-b' }),
    ]);
    let attempts = 0;
    const lockInOrder = (first: string, second: string) => () =>
      withTransaction(
        pool,
        async (tx) => {
          attempts++;
          await exec(tx, 'SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [first]);
          await new Promise((r) => setTimeout(r, 300)); // let the other side take its first lock
          await exec(tx, 'SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [second]);
        },
        noWait,
      );
    await Promise.all([lockInOrder(a.id, b.id)(), lockInOrder(b.id, a.id)()]);
    // Postgres aborts one side with 40P01 and the helper reruns it: 2 first attempts + 1 rerun.
    expect(attempts).toBe(3);
  });

  it('lockRows in (table, id) order never deadlocks when callers list targets in opposite order', async () => {
    const o1 = await organizations.insert(pool, { kind: 'FARMER', name: 'lk-1' });
    // lockRows only allows business tables; two draft rows stand in for any two lockable rows.
    await exec(pool, `INSERT INTO drafts (org_id, kind) SELECT $1, 'SALE_LISTING' FROM generate_series(1, 2)`, [o1.id]);
    const ids = (await many(pool, z.object({ id: z.string() }), 'SELECT id FROM drafts WHERE org_id = $1', [o1.id])).map((r) => r.id);
    let retried = 0;
    const run = (targets: string[]) =>
      withTransaction(
        pool,
        async (tx) => {
          const found = await lockRows(tx, targets.map((id) => ({ table: 'drafts' as const, id })));
          await new Promise((r) => setTimeout(r, 200));
          return found;
        },
        { ...noWait, onRetry: () => retried++ },
      );
    const [x, y] = await Promise.all([run(ids), run([...ids].reverse())]);
    expect([x, y]).toEqual([2, 2]);
    expect(retried).toBe(0);
  });

  it('rejects a table outside the lockable list', async () => {
    await expect(lockRows(pool, [{ table: 'users' as never, id: 'x' }])).rejects.toThrow(/not lockable/);
  });
});
