// Property 16: Webhook deduplication [DB]. Task 9.5. Validates: Requirements 2.5
import type { Server } from 'node:http';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LineChannelKey } from '../src/config/line.js';
import { many } from '../src/repos/index.js';
import { createWebhookService } from '../src/services/webhooks/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { evt, post, sign, startApp } from './webhook-helper.js';

const ROLES: LineChannelKey[] = ['farmer', 'baler', 'factory'];
// One delivery = one signed POST to one channel carrying several event ids (repeats allowed inside it).
const delivery = fc.record({
  role: fc.constantFrom(...ROLES),
  ids: fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 0, maxLength: 4 }),
});
// Waves run one after another (reordering and replays); deliveries inside a wave run concurrently.
const waves = fc.array(fc.array(delivery, { minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 4 });

describe.skipIf(!testDatabaseUrl)('Property 16: webhook deduplication (real Postgres)', () => {
  let db: TestDb; let server: Server; let base: string; let run = 0;
  beforeAll(async () => {
    db = await createTestDb();
    ({ base, server } = await startApp(createWebhookService({ pool: db.pool })));
  });
  afterAll(async () => { await new Promise<void>((r) => server?.close(() => r())); await db?.close(); });

  it('jobs and webhook_events equal the distinct (channel, event_id) pairs, and every response is 200', async () => {
    await fc.assert(fc.asyncProperty(waves, async (plan) => {
      // Fresh id namespace per run: rows cannot be deleted from a shared schema, so runs never overlap.
      const ns = `p16r${run++}-${Math.random().toString(36).slice(2, 8)}`;
      const expected = new Set<string>();
      const statuses: number[] = [];
      for (const wave of plan) {
        const rs = await Promise.all(wave.map((d) => {
          for (const i of d.ids) expected.add(`${d.role}:${ns}-${i}`);
          const b = JSON.stringify({ destination: 'Usynthetic', events: d.ids.map((i) => evt(`${ns}-${i}`)) });
          return post(base, d.role, b, sign(d.role, b));
        }));
        statuses.push(...rs.map((r) => r.status));
      }
      expect(statuses.every((s) => s === 200)).toBe(true);
      const like = `%:${ns}-%`;
      const jobs = await many(db.pool, z.object({ dedupe_key: z.string() }),
        `SELECT dedupe_key FROM jobs WHERE kind = 'line_event' AND dedupe_key LIKE $1`, [like]);
      const events = await many(db.pool, z.object({ channel: z.string(), event_id: z.string() }),
        `SELECT channel, event_id FROM webhook_events WHERE event_id LIKE $1`, [`${ns}-%`]);
      expect(jobs.length).toBe(expected.size);
      expect(new Set(jobs.map((j) => j.dedupe_key))).toEqual(expected);
      expect(events.length).toBe(expected.size);
      expect(new Set(events.map((e) => `${e.channel}:${e.event_id}`))).toEqual(expected);
    }));
  }, 120_000);
});
