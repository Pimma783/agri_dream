import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLineClient } from '../src/adapters/line/index.js';
import { HandlerRegistry, JobRunner, OutboxSender, PermanentJobError, RetryableJobError } from '../src/jobs/index.js';
import { exec, jobs, lineIdentities, offers, outbox } from '../src/repos/index.js';
import { createJobQueue, createOutboxQueue } from '../src/services/index.js';
import { createTestDb, runConcurrently, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeMarket } from './factories.js';

describe.skipIf(!testDatabaseUrl)('jobs runner and outbox sender (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let t = new Date('2030-01-01T00:00:00Z');
  const clock = { now: () => t, random: () => 0 };
  const policy = { baseMs: 1000, capMs: 60_000 };
  const jq = () => createJobQueue(pool);
  const oq = () => createOutboxQueue(pool);

  beforeAll(async () => { db = await createTestDb({ max: 8 }); pool = db.pool; });
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await exec(pool, 'DELETE FROM jobs'); await exec(pool, 'DELETE FROM notification_outbox'); t = new Date('2030-01-01T00:00:00Z'); });

  const runner = (h: HandlerRegistry) => new JobRunner({ queue: jq(), handlers: h, clock, backoff: policy, leaseMs: 10_000 });

  it('runs a handler and marks the job DONE', async () => {
    const seen: string[] = [];
    const h = new HandlerRegistry().register('k', async (job) => { seen.push(job.id); });
    const job = (await jq().enqueue({ kind: 'k', payload: { a: 1 } }))!;
    const r = await runner(h).tick();
    expect(r).toMatchObject({ claimed: 1, done: 1 });
    expect(seen).toEqual([job.id]);
    expect((await jobs.get(pool, job.id))!.status).toBe('DONE');
  });

  it('retries with backoff, then goes DEAD after max_attempts', async () => {
    const h = new HandlerRegistry().register('k', async () => { throw new Error('secret detail'); });
    const job = (await jq().enqueue({ kind: 'k', payload: {}, max_attempts: 2 }))!;
    const r = runner(h);
    expect((await r.tick()).retried).toBe(1);
    let row = (await jobs.get(pool, job.id))!;
    expect(row.status).toBe('RETRY');
    expect(row.run_at.getTime()).toBe(t.getTime() + 500); // attempt 1, jitter 0 => base/2
    expect(row.last_error_code).toBe('HANDLER_ERROR'); // message is never stored
    expect((await r.tick()).claimed).toBe(0); // not due yet
    t = new Date(t.getTime() + 1000);
    expect((await r.tick()).dead).toBe(1);
    row = (await jobs.get(pool, job.id))!;
    expect(row).toMatchObject({ status: 'DEAD', attempts: 2 });
    t = new Date(t.getTime() + 3_600_000);
    expect((await r.tick()).claimed).toBe(0);
  });

  it('PermanentJobError and unknown kinds go straight to DEAD; RetryableJobError honours retryAfterMs', async () => {
    const h = new HandlerRegistry()
      .register('perm', async () => { throw new PermanentJobError('BAD_PAYLOAD'); })
      .register('slow', async () => { throw new RetryableJobError('BUSY', 30_000); });
    const a = (await jq().enqueue({ kind: 'perm', payload: {} }))!;
    const b = (await jq().enqueue({ kind: 'nobody', payload: {} }))!;
    const c = (await jq().enqueue({ kind: 'slow', payload: {} }))!;
    await runner(h).tick();
    expect(await jobs.get(pool, a.id)).toMatchObject({ status: 'DEAD', last_error_code: 'BAD_PAYLOAD' });
    expect(await jobs.get(pool, b.id)).toMatchObject({ status: 'DEAD', last_error_code: 'NO_HANDLER' });
    const slow = (await jobs.get(pool, c.id))!;
    expect(slow.status).toBe('RETRY');
    expect(slow.run_at.getTime()).toBe(t.getTime() + 30_000);
  });

  it('two workers never run the same job; an expired lease is retaken; an exhausted expired lease is reaped', async () => {
    let runs = 0;
    const h = new HandlerRegistry().register('k', async () => { runs++; });
    for (let i = 0; i < 6; i++) await jq().enqueue({ kind: 'k', payload: { i } });
    await runConcurrently(4, () => runner(h).tick());
    expect(runs).toBe(6);

    // Crash simulation: claim without finishing.
    const crashed = (await jq().enqueue({ kind: 'k', payload: {}, max_attempts: 1 }))!;
    const crashed2 = (await jq().enqueue({ kind: 'k', payload: {}, max_attempts: 3 }))!;
    await jq().claim(t, 10_000, 10);
    t = new Date(t.getTime() + 10_001);
    expect((await runner(h).tick()).dead).toBe(1); // exhausted one
    expect((await jobs.get(pool, crashed.id))).toMatchObject({ status: 'DEAD', last_error_code: 'LEASE_EXPIRED' });
    expect((await jobs.get(pool, crashed2.id))).toMatchObject({ status: 'DONE', attempts: 2 });
  });

  describe('outbox sender', () => {
    const setup = async (channel: 'farmer' | 'baler' | 'factory' = 'farmer', over: { max_attempts?: number } = {}) => {
      const ident = await lineIdentities.ensure(pool, channel, `Usynthetic-${randomUUID()}`);
      const msg = (await outbox.enqueue(pool, {
        channel, to_line_identity_id: ident.id, message: [{ type: 'text', text: 'synthetic' }], dedupe_key: `d:${randomUUID()}`, ...over,
      }))!;
      return { ident, msg };
    };
    const sender = (line: FakeLineClient) => new OutboxSender({ queue: oq(), line, clock, backoff: policy, leaseMs: 10_000 });

    it('sends through the row channel with the stored retry key and marks SENT', async () => {
      const line = new FakeLineClient({ baler: 'synthetic-baler-token' });
      const { ident, msg } = await setup('baler');
      expect((await sender(line).tick()).sent).toBe(1);
      expect(line.pushes).toHaveLength(1);
      expect(line.pushes[0]).toMatchObject({ channel: 'baler', token: 'synthetic-baler-token', to: ident.line_user_id, retryKey: msg.retry_key });
      expect(await outbox.get(pool, msg.id)).toMatchObject({ status: 'SENT' });
      expect((await sender(line).tick()).claimed).toBe(0); // a SENT row is never sent again
      expect(line.pushes).toHaveLength(1);
    });

    it('retries with the same retry key, honours Retry-After, and does not double-deliver', async () => {
      const line = new FakeLineClient();
      const { msg } = await setup();
      line.failNext({ ok: false, code: 'RATE_LIMITED', retryAfterMs: 20_000 });
      const s = sender(line);
      expect((await s.tick()).retried).toBe(1);
      const row = (await outbox.get(pool, msg.id))!;
      expect(row.status).toBe('RETRY');
      expect(row.next_attempt_at.getTime()).toBe(t.getTime() + 20_000);
      expect((await s.tick()).claimed).toBe(0);
      t = new Date(t.getTime() + 20_000);
      expect((await s.tick()).sent).toBe(1);
      expect(line.pushes.map((p) => p.retryKey)).toEqual([msg.retry_key, msg.retry_key]);
      expect(line.delivered).toHaveLength(1);
    });

    it('treats a LINE duplicate answer as sent (crash after delivery, before markSent)', async () => {
      const line = new FakeLineClient();
      const { msg } = await setup();
      await line.forChannel('farmer').push({ to: 'x', messages: [{ type: 'text', text: 'a' }], retryKey: msg.retry_key });
      await oq().claim(t, 10_000, 5); // worker died holding the lease
      t = new Date(t.getTime() + 10_001);
      expect((await sender(line).tick()).sent).toBe(1);
      expect(line.delivered).toHaveLength(1);
      expect(await outbox.get(pool, msg.id)).toMatchObject({ status: 'SENT', attempts: 2 });
    });

    it('goes DEAD on permanent errors and when attempts run out, without touching offers or agreements', async () => {
      const market = await makeMarket(pool);
      const before = JSON.stringify(await offers.get(pool, market.offer.id));
      const line = new FakeLineClient();
      const perm = (await setup()).msg;
      const flaky = (await setup('farmer', { max_attempts: 1 })).msg;
      line.failNext({ ok: false, code: 'RECIPIENT_UNREACHABLE' }, { ok: false, code: 'UPSTREAM_5XX' });
      const r = await sender(line).tick();
      expect(r.dead).toBe(2);
      expect(await outbox.get(pool, perm.id)).toMatchObject({ status: 'DEAD', last_error_code: 'RECIPIENT_UNREACHABLE' });
      expect(await outbox.get(pool, flaky.id)).toMatchObject({ status: 'DEAD', last_error_code: 'UPSTREAM_5XX' });
      expect(JSON.stringify(await offers.get(pool, market.offer.id))).toBe(before);
      expect(await exec(pool, 'SELECT 1 FROM agreements')).toBe(0);
    });

    it('rejects a malformed message as DEAD without calling LINE', async () => {
      const line = new FakeLineClient();
      const ident = await lineIdentities.ensure(pool, 'farmer', `Usynthetic-${randomUUID()}`);
      const m = (await outbox.enqueue(pool, { channel: 'farmer', to_line_identity_id: ident.id, message: 'plain string', dedupe_key: `d:${randomUUID()}` }))!;
      await sender(line).tick();
      expect(line.pushes).toHaveLength(0);
      expect(await outbox.get(pool, m.id)).toMatchObject({ status: 'DEAD', last_error_code: 'INVALID_MESSAGE' });
    });
  });
});
