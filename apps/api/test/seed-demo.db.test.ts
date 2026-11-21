import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertSeedAllowed, readPasswords, runDemoSeed, type DemoPasswords } from '../scripts/seed-demo.js';
import { createMatchingService } from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';

// Test-only passwords, generated here, never a real credential.
const PW: DemoPasswords = { baler: 'test-pass-baler-1', factoryA: 'test-pass-fact-a-1', factoryB: 'test-pass-fact-b-1' };
// memberships has no is_demo column, so it is not part of this all-demo check.
const TABLES = ['organizations', 'users', 'drafts', 'material_listings', 'purchase_demands', 'baling_services', 'baling_requests'];

describe('seed guards', () => {
  it('refuses production without SEED_DEMO_CONFIRM=yes', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production' })).toThrow(/SEED_DEMO_CONFIRM/);
    expect(() => assertSeedAllowed({ NODE_ENV: 'production', SEED_DEMO_CONFIRM: 'yes' })).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: 'development' })).not.toThrow();
  });
  it('requires the three passwords and names only the variables in the error', () => {
    expect(() => readPasswords({ DEMO_BALER_PASSWORD: 'short' })).toThrow(/DEMO_BALER_PASSWORD, DEMO_FACTORY_A_PASSWORD, DEMO_FACTORY_B_PASSWORD/);
    const err = (() => { try { readPasswords({ DEMO_BALER_PASSWORD: 'short' }); } catch (e) { return String(e); } return ''; })();
    expect(err).not.toContain('short');
  });
});

describe.skipIf(!testDatabaseUrl)('demo seed (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
  });
  afterAll(async () => {
    await db?.close();
  });

  const state = async () => {
    const out: Record<string, unknown> = {};
    for (const t of TABLES) {
      out[t] = (await pool.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE is_demo)::int AS demo FROM ${t}`)).rows[0];
    }
    out.audit = (await pool.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0];
    return out;
  };

  it('is repeatable, all rows are demo, and matches are computed', async () => {
    const first = await runDemoSeed({ pool, passwords: PW });
    expect(first.organizations).toBe(6);
    expect(first.accountsCreated).toBe(6);
    expect(first.published).toBe(10);
    const afterFirst = await state();
    for (const t of TABLES) {
      const r = afterFirst[t] as { n: number; demo: number };
      expect(r.demo, t).toBe(r.n);
      expect(r.n, t).toBeGreaterThan(0);
    }
    expect((afterFirst.organizations as { n: number }).n).toBe(6);
    expect((afterFirst.material_listings as { n: number }).n).toBe(4);
    expect((afterFirst.purchase_demands as { n: number }).n).toBe(2);
    expect((afterFirst.baling_services as { n: number }).n).toBe(1);
    expect((afterFirst.baling_requests as { n: number }).n).toBe(3);

    // No phone, no real-looking email, no password in clear text.
    const emails = (await pool.query('SELECT email FROM users WHERE email IS NOT NULL')).rows.map((r) => r.email as string);
    expect(emails).toHaveLength(3);
    for (const e of emails) expect(e.endsWith('@example.invalid')).toBe(true);
    const hashes = (await pool.query('SELECT password_hash FROM users WHERE password_hash IS NOT NULL')).rows.map((r) => r.password_hash as string);
    expect(hashes).toHaveLength(3);
    for (const h of hashes) expect(h.startsWith('$argon2id$')).toBe(true);

    const second = await runDemoSeed({ pool, passwords: PW });
    expect(second.accountsCreated).toBe(0);
    expect(second.published).toBe(0);
    expect(second.alreadyPresent).toBe(10);
    expect(second.entities).toEqual(first.entities);
    expect(await state()).toEqual(afterFirst);

    // Publishing queued one recompute job per entity; run them directly.
    const jobs = (await pool.query(`SELECT payload FROM jobs WHERE kind = 'recompute_matches'`)).rows.map((r) => r.payload);
    expect(jobs).toHaveLength(10);
    const matching = createMatchingService({ pool });
    for (const payload of jobs) {
      const r = await matching.recompute(payload);
      expect(r.ok).toBe(true);
    }
    const { entities } = first;
    const pairs = (await pool.query('SELECT supply_id, demand_id, distance_km FROM matches')).rows;
    const has = (s: string, d: string) => pairs.some((p) => p.supply_id === entities[s]!.id && p.demand_id === entities[d]!.id);
    expect(has('listing-a-rice', 'demand-a')).toBe(true); // about 5 km, same material
    expect(has('listing-b-rice', 'demand-b')).toBe(true);
    expect(has('listing-a-rice', 'demand-b')).toBe(false); // over 80 km
    expect(has('listing-b-rice', 'demand-a')).toBe(false); // over 80 km
    expect(pairs.some((p) => p.supply_id === entities['listing-b-cane']!.id)).toBe(false); // wrong material
    expect(has('request-a', 'service-baler')).toBe(true);
    expect(has('request-b-far', 'service-baler')).toBe(false); // over 80 km
    expect(has('request-c-nocoord', 'service-baler')).toBe(false); // no coordinates

    // Recompute again: same rows.
    const before = (await pool.query('SELECT count(*)::int AS n FROM matches')).rows[0].n;
    for (const payload of jobs) await matching.recompute(payload);
    expect((await pool.query('SELECT count(*)::int AS n FROM matches')).rows[0].n).toBe(before);
  });

});

describe.skipIf(!testDatabaseUrl)('demo seed with --recompute (real Postgres)', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db?.close();
  });
  it('computes matches in-process once and a rerun changes nothing', async () => {
    const pool = db.pool;
    const snapshot = async () => ({
      matches: (await pool.query('SELECT supply_id, demand_id, route FROM matches ORDER BY 1, 2, 3')).rows,
      audit: (await pool.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n as number,
    });
    const first = await runDemoSeed({ pool, passwords: PW, recompute: true });
    expect(first.published).toBe(10);
    expect(first.recomputed).toBe(10);
    expect(first.matchRows).toBeGreaterThan(0);
    const { entities } = first;
    const pairs = (await pool.query('SELECT supply_id, demand_id FROM matches')).rows;
    expect(pairs).toHaveLength(first.matchRows);
    const has = (s: string, d: string) => pairs.some((p) => p.supply_id === entities[s]!.id && p.demand_id === entities[d]!.id);
    expect(has('listing-a-rice', 'demand-a')).toBe(true);
    expect(has('listing-a-rice', 'demand-b')).toBe(false);
    expect(has('request-a', 'service-baler')).toBe(true);
    const before = await snapshot();
    const second = await runDemoSeed({ pool, passwords: PW, recompute: true });
    expect(second.published).toBe(0);
    expect(second.alreadyPresent).toBe(10);
    expect(second.recomputed).toBe(0);
    expect(second.matchRows).toBe(first.matchRows);
    expect(await snapshot()).toEqual(before);
  });
});
