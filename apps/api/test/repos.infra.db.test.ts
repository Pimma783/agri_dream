import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs, conversations, idempotencyKeys, jobs, lineIdentities, messages, organizations, outbox, webhookEvents,
} from '../src/repos/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';

describe.skipIf(!testDatabaseUrl)('infrastructure repositories (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    await pool.query('DELETE FROM jobs');
  });
  afterAll(async () => {
    await db?.close();
  });

  it('webhook events dedupe on (channel, event_id)', async () => {
    const id = `ev-${Date.now()}`;
    expect(await webhookEvents.insertIfNew(pool, 'farmer', id, { type: 'message' })).not.toBeNull();
    expect(await webhookEvents.insertIfNew(pool, 'farmer', id, { type: 'message' })).toBeNull();
    expect(await webhookEvents.insertIfNew(pool, 'baler', id, [1, 2])).not.toBeNull();
    expect((await webhookEvents.getByEvent(pool, 'baler', id))?.payload).toEqual([1, 2]);
  });

  it('jobs: dedupe key, complete, retry and dead transitions', async () => {
    const key = `dk-${Date.now()}`;
    expect(await jobs.enqueue(pool, { kind: 'line_event', payload: { a: 1 }, dedupe_key: key })).not.toBeNull();
    expect(await jobs.enqueue(pool, { kind: 'line_event', payload: { a: 1 }, dedupe_key: key })).toBeNull();
    const now = new Date();
    const [claimed] = await jobs.claim(pool, now, 60_000);
    expect(claimed?.status).toBe('RUNNING');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.payload).toEqual({ a: 1 });
    const retry = await jobs.retryLater(pool, claimed!.id, new Date(now.getTime() + 1000), 'E1');
    expect(retry?.status).toBe('RETRY');
    expect(await jobs.claim(pool, now, 60_000)).toHaveLength(0); // not due yet
    const [again] = await jobs.claim(pool, new Date(now.getTime() + 2000), 60_000);
    expect(again?.attempts).toBe(2);
    expect((await jobs.complete(pool, again!.id))?.status).toBe('DONE');
    expect(await jobs.complete(pool, again!.id)).toBeNull();
  });

  it('jobs: an expired lease can be claimed again, a live lease cannot', async () => {
    await pool.query('DELETE FROM jobs');
    await jobs.enqueue(pool, { kind: 'k', payload: {} });
    const t0 = new Date();
    expect(await jobs.claim(pool, t0, 1000)).toHaveLength(1);
    expect(await jobs.claim(pool, new Date(t0.getTime() + 500), 1000)).toHaveLength(0);
    expect(await jobs.claim(pool, new Date(t0.getTime() + 1500), 1000)).toHaveLength(1);
  });

  it('jobs: two connections claiming at once never get the same row (SKIP LOCKED)', async () => {
    await pool.query('DELETE FROM jobs');
    for (let i = 0; i < 6; i++) await jobs.enqueue(pool, { kind: 'k', payload: { i } });
    const url = db.url; // pinned to this file's schema
    const c1 = new pg.Client({ connectionString: url });
    const c2 = new pg.Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      // Connection 1 claims 2 rows and keeps its transaction open, so those rows stay locked.
      await c1.query('BEGIN');
      const first = await jobs.claim(c1 as unknown as pg.PoolClient, new Date(), 60_000, 2);
      expect(first).toHaveLength(2);
      // Connection 2 must skip the locked rows instead of waiting, and get different ones.
      await c2.query('BEGIN');
      const second = await jobs.claim(c2 as unknown as pg.PoolClient, new Date(), 60_000, 4);
      expect(second).toHaveLength(4);
      const ids = new Set([...first, ...second].map((j) => j.id));
      expect(ids.size).toBe(6);
      await Promise.all([c1.query('COMMIT'), c2.query('COMMIT')]);
      expect(await jobs.claim(pool, new Date(), 60_000, 10)).toHaveLength(0); // all leased
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  });

  it('outbox: dedupe, claim, sent', async () => {
    const org = await organizations.insert(pool, { kind: 'FARMER', name: 'ob-org' });
    void org;
    const li = await lineIdentities.ensure(pool, 'farmer', `U-${Date.now()}`);
    const dk = `offer:${Date.now()}`;
    const row = await outbox.enqueue(pool, { channel: 'farmer', to_line_identity_id: li.id, message: { type: 'text', text: 'hi' }, dedupe_key: dk });
    expect(row?.status).toBe('PENDING');
    expect(await outbox.enqueue(pool, { channel: 'farmer', to_line_identity_id: li.id, message: {}, dedupe_key: dk })).toBeNull();
    const [claimed] = await outbox.claim(pool, new Date(), 30_000);
    expect(claimed?.id).toBe(row!.id);
    expect(claimed?.retry_key).toBe(row!.retry_key);
    const sent = await outbox.markSent(pool, row!.id, new Date());
    expect(sent?.status).toBe('SENT');
    expect(sent?.sent_at).toBeInstanceOf(Date);
  });

  it('idempotency keys: begin once, store and replay a response', async () => {
    const org = (await organizations.insert(pool, { kind: 'FARMER', name: 'idem-org' })).id;
    expect(await idempotencyKeys.begin(pool, org, 'publish', 'k1', 'h1')).not.toBeNull();
    expect(await idempotencyKeys.begin(pool, org, 'publish', 'k1', 'h1')).toBeNull();
    await idempotencyKeys.saveResponse(pool, org, 'publish', 'k1', { id: 'x', n: '1.5' });
    expect((await idempotencyKeys.get(pool, org, 'publish', 'k1'))?.response).toEqual({ id: 'x', n: '1.5' });
  });

  it('audit logs: append and read back, update is rejected', async () => {
    const eid = '5b6f6f2e-1c3a-4d39-9d2b-0d2a4b1a9f10';
    const a = await auditLogs.append(pool, { channel: 'system', action: 'TEST', entity_type: 'thing', entity_id: eid, detail: { k: 1 } });
    expect(a.id).toMatch(/^\d+$/);
    expect((await auditLogs.listByEntity(pool, 'thing', eid)).some((r) => r.id === a.id)).toBe(true);
    await expect(pool.query('UPDATE audit_logs SET action = $1 WHERE id = $2', ['X', a.id])).rejects.toThrow(/append-only/);
  });

  it('conversations and messages: latest lookup, source_event_id dedupe, recent order', async () => {
    const li = await lineIdentities.ensure(pool, 'farmer', `Uc-${Date.now()}`);
    const conv = await conversations.insert(pool, { channel: 'farmer', line_identity_id: li.id });
    expect((await conversations.latestByLineIdentity(pool, li.id))?.id).toBe(conv.id);
    const ev = `src-${Date.now()}`;
    expect(await messages.append(pool, { conversation_id: conv.id, direction: 'IN', text: 'one', source_event_id: ev })).not.toBeNull();
    expect(await messages.append(pool, { conversation_id: conv.id, direction: 'IN', text: 'dup', source_event_id: ev })).toBeNull();
    await messages.append(pool, { conversation_id: conv.id, direction: 'OUT', text: 'two' });
    expect((await messages.recent(pool, conv.id, 10)).map((m) => m.text)).toEqual(['one', 'two']);
  });
});
