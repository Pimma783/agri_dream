// Repeatable demo seed (task 14.1, Requirement 18.1 and 18.2). Run with `npm run seed:demo --workspace apps/api`.
//
// - Every row is is_demo=true. Names are synthetic and labelled เดโม/ตัวอย่าง. No phone numbers, no LINE IDs,
//   emails end in @example.invalid. Places are province-level coordinates, not anyone's address.
// - Rules and audit apply: accounts come from createDemoOrgUser, listings/demands/baling rows come from the
//   draft service (create, then a human-style publish), which also enqueues `recompute_matches`.
// - Repeatable: organizations are found by stable name or email, published rows by an idempotency marker
//   (scope `seed.demo`, one key per row). A second run changes nothing. Only is_demo rows are read or written.
// - DML only: no schema changes, no TRUNCATE. Works with the restricted hosted role.
// - Passwords come from environment variables and are never printed or stored in this file.
//   An existing demo account keeps its current password.
// - `--recompute` (or SEED_RECOMPUTE=yes) runs the matching service in this process for each seeded entity that has no
//   recorded recompute yet, so matches exist without the worker. Re-runs skip entities already recomputed.
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import type { Actor, Role } from '../src/domain/permissions.js';
import {
  createPool, idempotencyKeys, memberships, organizations, users, withTransaction, type Organization,
} from '../src/repos/index.js';
import { createDemoOrgUser } from '../src/services/auth/index.js';
import { createDraftService, createMatchingService, type DraftKind } from '../src/services/index.js';

export const SEED_SCOPE = 'seed.demo';
export const PASSWORD_ENV = {
  baler: 'DEMO_BALER_PASSWORD',
  factoryA: 'DEMO_FACTORY_A_PASSWORD',
  factoryB: 'DEMO_FACTORY_B_PASSWORD',
} as const;
export const MIN_PASSWORD_LENGTH = 12;

export interface DemoPasswords { baler: string; factoryA: string; factoryB: string }

type Pt = { lat: string; lng: string };
const UTT: Pt = { lat: '17.620000', lng: '100.100000' };
const UTT_FARM: Pt = { lat: '17.660000', lng: '100.120000' }; // about 5 km from UTT
const NSW: Pt = { lat: '15.700000', lng: '100.140000' };
const NSW_FARM: Pt = { lat: '15.740000', lng: '100.100000' };

interface OrgSpec {
  key: string;
  kind: Role;
  name: string;
  province: string;
  at: Pt | null;
  login?: { email: string; passwordKey: keyof DemoPasswords };
}
const ORGS: readonly OrgSpec[] = [
  { key: 'farmer-a', kind: 'FARMER', name: 'เดโม เกษตรกร A (ตัวอย่าง)', province: 'อุตรดิตถ์', at: UTT_FARM },
  { key: 'farmer-b', kind: 'FARMER', name: 'เดโม เกษตรกร B (ตัวอย่าง)', province: 'นครสวรรค์', at: NSW_FARM },
  { key: 'farmer-c', kind: 'FARMER', name: 'เดโม เกษตรกร C (ตัวอย่าง)', province: 'กำแพงเพชร', at: null },
  { key: 'baler', kind: 'BALER', name: 'เดโม โรงงานอัดฟาง (ตัวอย่าง)', province: 'อุตรดิตถ์', at: UTT,
    login: { email: 'demo-baler@example.invalid', passwordKey: 'baler' } },
  { key: 'factory-a', kind: 'BUYER_FACTORY', name: 'เดโม โรงงานปลายทาง ก (ตัวอย่าง)', province: 'อุตรดิตถ์', at: UTT,
    login: { email: 'demo-factory-a@example.invalid', passwordKey: 'factoryA' } },
  { key: 'factory-b', kind: 'BUYER_FACTORY', name: 'เดโม โรงงานปลายทาง ข (ตัวอย่าง)', province: 'นครสวรรค์', at: NSW,
    login: { email: 'demo-factory-b@example.invalid', passwordKey: 'factoryB' } },
];

interface RowSpec { key: string; org: string; kind: DraftKind; patch: Record<string, unknown> }
const kg = (value: string) => ({ value, unit: 'kg' });
const perKg = (value: string) => ({ value, unit: 'kg' });
const ROWS: readonly RowSpec[] = [
  // Listings. A: matches factory A (about 5 km) and is over 80 km from factory B. B is the reverse.
  { key: 'listing-a-rice', org: 'farmer-a', kind: 'SALE_LISTING', patch: {
    material_type: 'RICE_STRAW', material_form: 'LOOSE', quantity: kg('20000'), price_mode: 'FIXED', price: perKg('1.2'),
    province: 'อุตรดิตถ์', district: 'เดโม อำเภอตัวอย่าง', ...UTT_FARM, transport_by: 'EITHER' } },
  { key: 'listing-b-rice', org: 'farmer-b', kind: 'SALE_LISTING', patch: {
    material_type: 'RICE_STRAW', material_form: 'LOOSE', quantity: kg('30000'), price_mode: 'FIXED', price: perKg('1.1'),
    province: 'นครสวรรค์', district: 'เดโม อำเภอตัวอย่าง', ...NSW_FARM, transport_by: 'SELLER' } },
  // Wrong material: no demand accepts sugarcane leaves.
  { key: 'listing-b-cane', org: 'farmer-b', kind: 'SALE_LISTING', patch: {
    material_type: 'CANE_LEAF', quantity: kg('12000'), price_mode: 'NEGOTIABLE',
    province: 'นครสวรรค์', ...NSW_FARM } },
  // Missing coordinates: matching must report it instead of guessing from the province.
  { key: 'listing-c-rice', org: 'farmer-c', kind: 'SALE_LISTING', patch: {
    material_type: 'RICE_STRAW', quantity: kg('8000'), price_mode: 'FIXED', price: perKg('1.0'), province: 'กำแพงเพชร' } },
  // Demands.
  { key: 'demand-a', org: 'factory-a', kind: 'PURCHASE_DEMAND', patch: {
    accepted_materials: ['RICE_STRAW'], target_quantity: kg('100000'), price_mode: 'FIXED', price: perKg('1.8'),
    province: 'อุตรดิตถ์', ...UTT, radius_km: '80', transport_by: 'EITHER' } },
  { key: 'demand-b', org: 'factory-b', kind: 'PURCHASE_DEMAND', patch: {
    accepted_materials: ['RICE_STRAW', 'CORN_COB'], target_quantity: kg('150000'), price_mode: 'FIXED', price: perKg('1.6'),
    province: 'นครสวรรค์', ...NSW, radius_km: '80', transport_by: 'BUYER' } },
  // Baling service (baler) and baling requests (farmers).
  { key: 'service-baler', org: 'baler', kind: 'BALING_SERVICE', patch: {
    material_types: ['RICE_STRAW'], baling_format: 'ก้อนสี่เหลี่ยม (ตัวอย่าง)', service_mode: 'BOTH', service_provinces: ['อุตรดิตถ์'],
    province: 'อุตรดิตถ์', ...UTT, capacity: kg('200000'), price_mode: 'FIXED', price: { value: '0.5', unit: 'kg' } } },
  { key: 'request-a', org: 'farmer-a', kind: 'BALING_REQUEST', patch: {
    material_type: 'RICE_STRAW', quantity: kg('10000'), requested_mode: 'ON_SITE', province: 'อุตรดิตถ์', ...UTT_FARM } },
  // About 215 km from the baler.
  { key: 'request-b-far', org: 'farmer-b', kind: 'BALING_REQUEST', patch: {
    material_type: 'RICE_STRAW', quantity: kg('9000'), requested_mode: 'ON_SITE', province: 'นครสวรรค์', ...NSW_FARM } },
  { key: 'request-c-nocoord', org: 'farmer-c', kind: 'BALING_REQUEST', patch: {
    material_type: 'RICE_STRAW', quantity: kg('6000'), requested_mode: 'ON_SITE', province: 'กำแพงเพชร' } },
];

export interface SeedSummary {
  organizations: number;
  accountsCreated: number;
  published: number;
  alreadyPresent: number;
  /** Entities recomputed by this run (0 unless `recompute` is set). */
  recomputed: number;
  /** Match rows that involve a seeded entity (after this run). */
  matchRows: number;
  /** key to published entity id, for operators and tests. */
  entities: Record<string, { type: string; id: string }>;
}

export function readPasswords(env: NodeJS.ProcessEnv): DemoPasswords {
  const out = {} as DemoPasswords;
  const bad: string[] = [];
  for (const [k, name] of Object.entries(PASSWORD_ENV) as [keyof DemoPasswords, string][]) {
    const v = env[name] ?? '';
    if (v.length < MIN_PASSWORD_LENGTH) bad.push(name);
    out[k] = v;
  }
  if (bad.length) throw new Error(`Set ${bad.join(', ')} (at least ${MIN_PASSWORD_LENGTH} characters each) before seeding.`);
  return out;
}

export function assertSeedAllowed(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production' && env.SEED_DEMO_CONFIRM !== 'yes') {
    throw new Error('Refusing to seed demo data with NODE_ENV=production. Set SEED_DEMO_CONFIRM=yes to confirm.');
  }
}

async function ensureOrg(pool: pg.Pool, spec: OrgSpec, passwords: DemoPasswords): Promise<{ org: Organization; userId: string; created: boolean }> {
  if (spec.login) {
    const existing = await users.getByEmail(pool, spec.login.email);
    if (existing) {
      if (!existing.is_demo) throw new Error(`Refusing to touch a non-demo user for ${spec.key}.`);
      const org = await findMemberOrg(pool, existing.id, spec);
      if (!org) throw new Error(`Demo user for ${spec.key} has no demo organization.`);
      return { org, userId: existing.id, created: false };
    }
    const { org, user } = await createDemoOrgUser(pool, {
      kind: spec.kind, orgName: spec.name, email: spec.login.email, password: passwords[spec.login.passwordKey],
      displayName: spec.name, province: spec.province, ...(spec.at ?? {}),
    });
    return { org, userId: user.id, created: true };
  }
  const found = (await organizations.listByKind(pool, spec.kind)).find((o) => o.is_demo && o.name === spec.name);
  if (found) {
    const owner = (await memberships.listByOrg(pool, found.id))[0];
    if (!owner) throw new Error(`Demo organization ${spec.key} has no member.`);
    return { org: found, userId: owner.user_id, created: false };
  }
  return withTransaction(pool, async (tx) => {
    const org = await organizations.insert(tx, {
      kind: spec.kind, name: spec.name, province: spec.province, lat: spec.at?.lat ?? null, lng: spec.at?.lng ?? null, is_demo: true,
    });
    const user = await users.insert(tx, { display_name: spec.name, is_demo: true });
    await memberships.insert(tx, { user_id: user.id, org_id: org.id, member_role: 'OWNER' });
    return { org, userId: user.id, created: true };
  });
}

async function findMemberOrg(pool: pg.Pool, userId: string, spec: OrgSpec): Promise<Organization | null> {
  for (const m of await memberships.listByUser(pool, userId)) {
    const org = await organizations.get(pool, m.org_id);
    if (org && org.is_demo && org.kind === spec.kind) return org;
  }
  return null;
}

export async function runDemoSeed(deps: { pool: pg.Pool; passwords: DemoPasswords; recompute?: boolean }): Promise<SeedSummary> {
  const { pool, passwords } = deps;
  const drafts = createDraftService({ pool });
  const actors = new Map<string, Actor>();
  let accountsCreated = 0;
  for (const spec of ORGS) {
    const r = await ensureOrg(pool, spec, passwords);
    if (r.created) accountsCreated++;
    actors.set(spec.key, { userId: r.userId, orgId: r.org.id, role: spec.kind, channel: 'web' });
  }
  const summary: SeedSummary = { organizations: ORGS.length, accountsCreated, published: 0, alreadyPresent: 0, recomputed: 0, matchRows: 0, entities: {} };
  for (const row of ROWS) {
    const actor = actors.get(row.org) as Actor;
    const marker = await idempotencyKeys.get(pool, actor.orgId, SEED_SCOPE, row.key);
    if (marker?.response) {
      summary.alreadyPresent++;
      summary.entities[row.key] = marker.response as { type: string; id: string };
      continue;
    }
    const created = await drafts.create(actor, { kind: row.kind, patch: row.patch });
    if (!created.ok) throw new Error(`seed row ${row.key}: create failed (${created.error.code})`);
    const { draft } = created.value;
    // Services create drafts with is_demo=false; the published entity copies the draft's flag.
    await pool.query('UPDATE drafts SET is_demo = true WHERE id = $1 AND org_id = $2', [draft.id, actor.orgId]);
    const published = await drafts.publish(actor, { draftId: draft.id, expectedVersion: draft.version });
    if (!published.ok) throw new Error(`seed row ${row.key}: publish failed (${published.error.code})`);
    const entity = { type: published.value.entity_type, id: published.value.entity_id };
    await idempotencyKeys.begin(pool, actor.orgId, SEED_SCOPE, row.key, row.key);
    await idempotencyKeys.saveResponse(pool, actor.orgId, SEED_SCOPE, row.key, entity);
    summary.published++;
    summary.entities[row.key] = entity;
  }
  const ids = Object.values(summary.entities).map((e) => e.id);
  if (deps.recompute) {
    const matching = createMatchingService({ pool });
    for (const e of Object.values(summary.entities)) {
      const done = await pool.query(
        `SELECT 1 FROM audit_logs WHERE action = 'matches.recomputed' AND entity_id = $1 LIMIT 1`, [e.id]);
      if (done.rowCount) continue;
      const r = await matching.recompute({ entity_type: e.type, entity_id: e.id, version: 1 });
      if (!r.ok) throw new Error(`seed recompute failed (${r.error.code})`);
      summary.recomputed++;
    }
  }
  summary.matchRows = (await pool.query(
    'SELECT count(*)::int AS n FROM matches WHERE supply_id = ANY($1::uuid[]) OR demand_id = ANY($1::uuid[])', [ids])).rows[0].n;
  return summary;
}

async function main(): Promise<void> {
  assertSeedAllowed(process.env);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const passwords = readPasswords(process.env);
  const pool = createPool(url, { max: 4 });
  try {
    const recompute = process.argv.includes('--recompute') || process.env.SEED_RECOMPUTE === 'yes';
    const s = await runDemoSeed({ pool, passwords, recompute });
    console.log(`demo seed done: organizations=${s.organizations} accounts_created=${s.accountsCreated} published=${s.published} already_present=${s.alreadyPresent} recomputed=${s.recomputed} match_rows=${s.matchRows}`);
    for (const [key, e] of Object.entries(s.entities)) console.log(`  ${key}: ${e.type} ${e.id}`);
    console.log(recompute ? 'matches computed in this process.' : 'recompute_matches jobs are queued; the worker computes the matches.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : 'demo seed failed');
    process.exitCode = 1;
  });
}
