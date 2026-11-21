import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/domain/permissions.js';
import { idempotencyKeys } from '../src/repos/index.js';
import { appError, audit, err, inTransaction, ok, withIdempotency } from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeOrgWithUser } from './factories.js';

describe.skipIf(!testDatabaseUrl)('service foundation (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
  });
  afterAll(async () => {
    await db?.close();
  });
  const countDrafts = async (orgId: string) =>
    Number((await pool.query('SELECT count(*) FROM drafts WHERE org_id = $1', [orgId])).rows[0].count);
  async function insertDraft(tx: pg.PoolClient, orgId: string, userId: string) {
    await tx.query(`INSERT INTO drafts (org_id, created_by, kind, data) VALUES ($1,$2,'SALE_LISTING','{}')`, [orgId, userId]);
  }

  it('inTransaction commits Ok and rolls back Err (including audit rows)', async () => {
    const { org, user } = await makeOrgWithUser(pool, 'FARMER');
    const actor: Actor = { userId: user.id, orgId: org.id, role: 'FARMER', channel: 'line:farmer' };
    const bad = await inTransaction({ pool }, async (tx) => {
      await insertDraft(tx, org.id, user.id);
      await audit(tx, actor, { action: 'rolled.back', entityType: 'draft' });
      return err(appError('INVALID_STATE'));
    });
    expect(bad).toEqual(err(appError('INVALID_STATE')));
    expect(await countDrafts(org.id)).toBe(0);
    expect((await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'rolled.back'`)).rowCount).toBe(0);

    const good = await inTransaction({ pool }, async (tx) => {
      await insertDraft(tx, org.id, user.id);
      const a = await audit(tx, actor, { action: 'draft.created', entityType: 'draft', detail: { n: 1 } });
      return ok(a.id);
    });
    expect(good.ok).toBe(true);
    expect(await countDrafts(org.id)).toBe(1);
    const row = (await pool.query(`SELECT actor_org_id, channel, action FROM audit_logs WHERE action = 'draft.created' AND actor_org_id = $1`, [org.id])).rows[0];
    expect(row).toMatchObject({ actor_org_id: org.id, channel: 'line', action: 'draft.created' });
  });

  it('maps an exhausted deadlock/serialization retry to CONFLICT_RETRY', async () => {
    const r = await inTransaction({ pool }, async () => {
      throw Object.assign(new Error('x'), { code: '40001' });
    }).catch((e: unknown) => e);
    // withTransaction sleeps between retries; the outcome must be a CONFLICT_RETRY Err, not a throw.
    expect(r).toEqual(err(appError('CONFLICT_RETRY')));
  });

  it('withIdempotency runs once, replays, and rejects a different request', async () => {
    const { org, user } = await makeOrgWithUser(pool, 'FARMER');
    let runs = 0;
    const run = (request: unknown, key = 'k1') =>
      withIdempotency({ pool }, { orgId: org.id, scope: 'draft.publish:x', key, request }, async (tx) => {
        runs++;
        await insertDraft(tx, org.id, user.id);
        return ok({ id: 'result', n: runs });
      });
    const first = await run({ v: 1 });
    expect(first).toEqual(ok({ value: { id: 'result', n: 1 }, replayed: false }));
    expect(await run({ v: 1 })).toEqual(ok({ value: { id: 'result', n: 1 }, replayed: true }));
    expect(await run({ v: 2 })).toEqual(err(appError('IDEMPOTENCY_MISMATCH')));
    expect(runs).toBe(1);
    expect(await countDrafts(org.id)).toBe(1);
    expect((await idempotencyKeys.get(pool, org.id, 'draft.publish:x', 'k1'))?.response).toEqual({ id: 'result', n: 1 });
  });

  it('does not store the key when fn returns Err, so a retry can run', async () => {
    const { org } = await makeOrgWithUser(pool, 'FARMER');
    const input = { orgId: org.id, scope: 's', key: 'k', request: {} };
    expect(await withIdempotency({ pool }, input, async () => err(appError('STALE_VERSION')))).toEqual(err(appError('STALE_VERSION')));
    expect(await idempotencyKeys.get(pool, org.id, 's', 'k')).toBeNull();
    expect((await withIdempotency({ pool }, input, async () => ok(1))).ok).toBe(true);
  });

  it('concurrent duplicates with one key execute once', async () => {
    const { org, user } = await makeOrgWithUser(pool, 'FARMER');
    const input = { orgId: org.id, scope: 'c', key: 'same', request: { a: 1 } };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        withIdempotency({ pool }, input, async (tx) => {
          await insertDraft(tx, org.id, user.id);
          return ok('done');
        }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && !r.value.replayed)).toHaveLength(1);
    expect(await countDrafts(org.id)).toBe(1);
  });
});
