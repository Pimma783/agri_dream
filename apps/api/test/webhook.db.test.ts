import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { many } from '../src/repos/index.js';
import { createWebhookService } from '../src/services/webhooks/index.js';
import { z } from 'zod';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { evt, post, sign, startApp } from './webhook-helper.js';
describe.skipIf(!testDatabaseUrl)('LINE webhooks (real Postgres)', () => {
  let db: TestDb; let server: Server; let base: string;
  beforeAll(async () => {
    db = await createTestDb();
    ({ base, server } = await startApp(createWebhookService({ pool: db.pool })));
  });
  afterAll(async () => { await new Promise<void>((r) => server?.close(() => r())); await db?.close(); });
  const counts = async () => {
    const C = z.object({ n: z.coerce.number() });
    const [e] = await many(db.pool, C, 'SELECT count(*) AS n FROM webhook_events', []);
    const [j] = await many(db.pool, C, `SELECT count(*) AS n FROM jobs WHERE kind = 'line_event'`, []);
    return { events: e?.n, jobs: j?.n };
  };
  const send = (role: 'farmer' | 'baler' | 'factory', events: unknown[]) => {
    const b = JSON.stringify({ destination: 'Usynthetic', events });
    return post(base, role, b, sign(role, b));
  };
  it('stores one event and one job per new event, with the channel:event_id dedupe key', async () => {
    expect((await send('farmer', [evt('a1'), evt('a2')])).status).toBe(200);
    expect(await counts()).toEqual({ events: 2, jobs: 2 });
    const keys = await many(db.pool, z.object({ dedupe_key: z.string(), payload: z.unknown() }), `SELECT dedupe_key, payload FROM jobs ORDER BY dedupe_key`, []);
    expect(keys.map((k) => k.dedupe_key)).toEqual(['farmer:a1', 'farmer:a2']);
  });
  it('a replayed event returns 200 and creates no second job', async () => {
    const before = await counts();
    expect((await send('farmer', [evt('a1')])).status).toBe(200);
    expect(await counts()).toEqual(before);
  });
  it('the same event id on another channel is a separate event', async () => {
    const before = await counts();
    expect((await send('baler', [evt('a1')])).status).toBe(200);
    expect(await counts()).toEqual({ events: (before.events ?? 0) + 1, jobs: (before.jobs ?? 0) + 1 });
  });
  it('concurrent delivery of the same event creates exactly one job', async () => {
    const before = await counts();
    const rs = await Promise.all(Array.from({ length: 6 }, () => send('factory', [evt('race')])));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(await counts()).toEqual({ events: (before.events ?? 0) + 1, jobs: (before.jobs ?? 0) + 1 });
  });
  it('bad signature, bad shape and empty events insert nothing', async () => {
    const before = await counts();
    const b = JSON.stringify({ events: [evt('zz')] });
    expect((await post(base, 'farmer', b, sign('baler', b))).status).toBe(401);
    expect((await send('farmer', [{ type: 'message' }])).status).toBe(400);
    expect((await send('farmer', [])).status).toBe(200);
    expect(await counts()).toEqual(before);
  });
});
