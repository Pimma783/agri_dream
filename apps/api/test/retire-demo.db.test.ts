import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/domain/permissions.js';
import { memberships, organizations, users } from '../src/repos/index.js';
import { createDraftService, createMatchingService } from '../src/services/index.js';
import { assertRetireAllowed, runRetireDemo } from '../scripts/retire-demo-postings.js';
import { runDemoSeed, type DemoPasswords } from '../scripts/seed-demo.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';

const PW: DemoPasswords = { baler: 'test-pass-baler-1', factoryA: 'test-pass-fact-a-1', factoryB: 'test-pass-fact-b-1' };
const POSTING_TABLES = ['material_listings', 'purchase_demands', 'baling_services', 'baling_requests'];
const ACCOUNT_TABLES = ['organizations', 'users', 'memberships', 'line_identities'];

describe('retire-demo guard', () => {
  it('refuses production without SEED_DEMO_CONFIRM=yes', () => {
    expect(() => assertRetireAllowed({ NODE_ENV: 'production' })).toThrow(/SEED_DEMO_CONFIRM/);
    expect(() => assertRetireAllowed({ NODE_ENV: 'production', SEED_DEMO_CONFIRM: 'yes' })).not.toThrow();
    expect(() => assertRetireAllowed({ NODE_ENV: 'development' })).not.toThrow();
  });
});

describe.skipIf(!testDatabaseUrl)('retire demo postings (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
  });
  afterAll(async () => {
    await db?.close();
  });

  async function userOrg(kind: 'FARMER' | 'BUYER_FACTORY', name: string): Promise<Actor> {
    const org = await organizations.insert(pool, { kind, name, province: 'อุตรดิตถ์', lat: '17.620000', lng: '100.100000', is_demo: false });
    const user = await users.insert(pool, { display_name: name, is_demo: false });
    await memberships.insert(pool, { user_id: user.id, org_id: org.id, member_role: 'OWNER' });
    return { userId: user.id, orgId: org.id, role: kind, channel: 'web' };
  }
  async function publish(actor: Actor, kind: 'SALE_LISTING' | 'PURCHASE_DEMAND', patch: Record<string, unknown>) {
    const drafts = createDraftService({ pool });
    const c = await drafts.create(actor, { kind, patch });
    if (!c.ok) throw new Error('create failed');
    const p = await drafts.publish(actor, { draftId: c.value.draft.id, expectedVersion: c.value.draft.version });
    if (!p.ok) throw new Error('publish failed');
    return { type: p.value.entity_type, id: p.value.entity_id };
  }
  const count = async (t: string, where = 'true') => (await pool.query(`SELECT count(*)::int AS n FROM ${t} WHERE ${where}`)).rows[0].n as number;
  const accounts = async () => Object.fromEntries(await Promise.all(ACCOUNT_TABLES.map(async (t) => [t, await count(t)])));
  const open = async (t: string, demo: boolean) => count(t, `is_demo = ${demo} AND status = 'PUBLISHED'`);

  it('closes only seed postings, keeps user rows and accounts, and is repeatable', async () => {
    const seeded = await runDemoSeed({ pool, passwords: PW, recompute: true });
    expect(seeded.published).toBe(10);

    // User-created postings: a farmer listing next to demand-a, and a factory demand without any seed marker.
    const farmer = await userOrg('FARMER', 'user farmer');
    const factory = await userOrg('BUYER_FACTORY', 'user factory');
    const listing = await publish(farmer, 'SALE_LISTING', {
      material_type: 'RICE_STRAW', material_form: 'LOOSE', quantity: { value: '5000', unit: 'kg' }, price_mode: 'FIXED',
      price: { value: '1.0', unit: 'kg' }, province: 'อุตรดิตถ์', lat: '17.660000', lng: '100.120000', transport_by: 'EITHER' });
    const demand = await publish(factory, 'PURCHASE_DEMAND', {
      accepted_materials: ['RICE_STRAW'], target_quantity: { value: '50000', unit: 'kg' }, price_mode: 'FIXED',
      price: { value: '1.5', unit: 'kg' }, province: 'อุตรดิตถ์', lat: '17.620000', lng: '100.100000', radius_km: '80', transport_by: 'EITHER' });
    const matching = createMatchingService({ pool });
    for (const e of [listing, demand]) expect((await matching.recompute({ entity_type: e.type, entity_id: e.id, version: 1 })).ok).toBe(true);

    const matchesOf = async (id: string) => count('matches', `supply_id = '${id}' OR demand_id = '${id}'`);
    const demandA = seeded.entities['demand-a']!.id;
    const pairExists = async (s: string, d: string) => (await count('matches', `supply_id = '${s}' AND demand_id = '${d}'`)) > 0;
    expect(await pairExists(listing.id, demandA)).toBe(true);
    expect(await pairExists(listing.id, demand.id)).toBe(true);
    expect(await matchesOf(seeded.entities['listing-a-rice']!.id)).toBeGreaterThan(0);
    const accountsBefore = await accounts();
    const markersBefore = await count('idempotency_keys', `scope = 'seed.demo'`);

    const first = await runRetireDemo({ pool });
    expect(first.retired).toBe(10);
    expect(first.alreadyClosed).toBe(0);
    expect(first.skipped).toBe(0);
    expect(first.matchesRemoved).toBeGreaterThan(0);

    // Seed postings are CLOSED (not deleted); user postings stay PUBLISHED.
    for (const t of POSTING_TABLES) expect(await open(t, true), t).toBe(0);
    expect(await count('material_listings', `is_demo AND status = 'CLOSED'`)).toBe(4);
    expect(await count('purchase_demands', `is_demo AND status = 'CLOSED'`)).toBe(2);
    expect(await count('baling_services', `is_demo AND status = 'CLOSED'`)).toBe(1);
    expect(await count('baling_requests', `is_demo AND status = 'CLOSED'`)).toBe(3);
    expect(await open('material_listings', false)).toBe(1);
    expect(await open('purchase_demands', false)).toBe(1);

    // Matches of retired postings are gone, matches between user postings remain.
    for (const e of Object.values(seeded.entities)) expect(await matchesOf(e.id), e.id).toBe(0);
    expect(await pairExists(listing.id, demand.id)).toBe(true);
    expect(await pairExists(listing.id, demandA)).toBe(false);

    // Accounts and markers are untouched.
    expect(await accounts()).toEqual(accountsBefore);
    expect(await count('idempotency_keys', `scope = 'seed.demo'`)).toBe(markersBefore);

    // Second run: no change.
    const auditBefore = await count('audit_logs');
    const second = await runRetireDemo({ pool });
    expect(second).toEqual({ retired: 0, alreadyClosed: 10, skipped: 0, recomputed: 0, matchesRemoved: 0 });
    expect(await count('audit_logs')).toBe(auditBefore);

    // The seed does not republish retired postings.
    const again = await runDemoSeed({ pool, passwords: PW, recompute: true });
    expect(again.published).toBe(0);
    expect(again.alreadyPresent).toBe(10);
    expect(again.accountsCreated).toBe(0);
    for (const t of POSTING_TABLES) expect(await open(t, true), t).toBe(0);
    expect(await count('material_listings')).toBe(5);
    expect(await accounts()).toEqual(accountsBefore);
    for (const e of Object.values(seeded.entities)) expect(await matchesOf(e.id), e.id).toBe(0);
  });
});
