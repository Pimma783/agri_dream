// Retire the demo seed's postings without deleting anything (task 23.3, Requirements 18 and 19).
// Run with `npm run retire-demo --workspace apps/api` (or `tsx scripts/retire-demo-postings.ts`).
//
// - Only entities named by a seed marker (idempotency_keys scope `seed.demo`) AND still flagged is_demo=true are closed.
//   User-created postings (is_demo=false, or without a marker, e.g. the owner test organization) are never read for change.
// - Closing goes through the lifecycle services (audit row + status machine): PUBLISHED -> CLOSED, PAUSED -> CANCELLED.
// - Matches of each retired entity are recomputed in this process, so they disappear without the worker.
// - Organizations, users, memberships and LINE identities are never touched. The seed markers stay, so a later
//   seed run counts these rows as already_present and does not republish them.
// - Repeatable: a second run reports 0 changes. Prints counts only.
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import type { Actor, Role } from '../src/domain/permissions.js';
import { balingRequests, balingServices, createPool, demands, listings, memberships, organizations } from '../src/repos/index.js';
import {
  createBalingRequestService, createBalingServiceService, createDemandService, createListingService, createMatchingService,
  type LifecycleService, type ManagedRow,
} from '../src/services/index.js';
import { SEED_SCOPE } from './seed-demo.js';

type EntityType = 'LISTING' | 'DEMAND' | 'BALING_SERVICE' | 'BALING_REQUEST';
const TYPES: readonly EntityType[] = ['LISTING', 'DEMAND', 'BALING_SERVICE', 'BALING_REQUEST'];

export interface RetireSummary {
  /** Postings closed (or cancelled when paused) by this run. */
  retired: number;
  /** Seed postings that were already CLOSED or CANCELLED before this run. */
  alreadyClosed: number;
  /** Markers whose entity is missing or not is_demo (left alone). */
  skipped: number;
  /** Entities recomputed in this process. */
  recomputed: number;
  /** Match rows removed by this run. */
  matchesRemoved: number;
}

export function assertRetireAllowed(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production' && env.SEED_DEMO_CONFIRM !== 'yes') {
    throw new Error('Refusing to retire demo postings with NODE_ENV=production. Set SEED_DEMO_CONFIRM=yes to confirm.');
  }
}

interface Row extends ManagedRow { is_demo: boolean }

export async function runRetireDemo(deps: { pool: pg.Pool }): Promise<RetireSummary> {
  const { pool } = deps;
  const ctx = { pool };
  const repos = {
    LISTING: listings, DEMAND: demands, BALING_SERVICE: balingServices, BALING_REQUEST: balingRequests,
  } as unknown as Record<EntityType, { get(db: pg.Pool, id: string): Promise<Row | null> }>;
  const services = {
    LISTING: createListingService(ctx), DEMAND: createDemandService(ctx),
    BALING_SERVICE: createBalingServiceService(ctx), BALING_REQUEST: createBalingRequestService(ctx),
  } as unknown as Record<EntityType, LifecycleService<Row>>;
  const matching = createMatchingService(ctx);
  const summary: RetireSummary = { retired: 0, alreadyClosed: 0, skipped: 0, recomputed: 0, matchesRemoved: 0 };

  const markers = (await pool.query(
    'SELECT org_id, response FROM idempotency_keys WHERE scope = $1 AND response IS NOT NULL ORDER BY created_at, key', [SEED_SCOPE],
  )).rows as { org_id: string; response: { type?: string; id?: string } }[];

  const matchCount = async (id: string): Promise<number> =>
    (await pool.query('SELECT count(*)::int AS n FROM matches WHERE supply_id = $1 OR demand_id = $1', [id])).rows[0].n;

  for (const m of markers) {
    const type = m.response.type as EntityType;
    const id = m.response.id;
    if (!TYPES.includes(type) || typeof id !== 'string') { summary.skipped++; continue; }
    const row = await repos[type].get(pool, id);
    if (!row || !row.is_demo || row.org_id !== m.org_id) { summary.skipped++; continue; }

    const open = row.status === 'PUBLISHED' || row.status === 'PAUSED';
    if (!open) summary.alreadyClosed++;
    else {
      const org = await organizations.get(pool, row.org_id);
      const owner = (await memberships.listByOrg(pool, row.org_id))[0];
      if (!org || !org.is_demo || !owner) { summary.skipped++; continue; }
      const actor: Actor = { userId: owner.user_id, orgId: org.id, role: org.kind as Role, channel: 'web' };
      const input = { id, expectedVersion: row.version };
      const r = row.status === 'PUBLISHED' ? await services[type].close(actor, input) : await services[type].cancel(actor, input);
      if (!r.ok) throw new Error(`retire ${type}: ${row.status} -> closed failed (${r.error.code})`);
      summary.retired++;
    }

    // Recompute in this process when the entity was just retired or still has match rows (e.g. a worker that never ran).
    const before = await matchCount(id);
    if (open || before > 0) {
      const current = (await repos[type].get(pool, id)) as Row;
      const rc = await matching.recompute({ entity_type: type, entity_id: id, version: current.version });
      if (!rc.ok) throw new Error(`retire recompute failed (${rc.error.code})`);
      summary.recomputed++;
      summary.matchesRemoved += before - (await matchCount(id));
    }
  }
  return summary;
}

async function main(): Promise<void> {
  assertRetireAllowed(process.env);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const pool = createPool(url, { max: 4 });
  try {
    const s = await runRetireDemo({ pool });
    console.log(`demo retire done: retired=${s.retired} already_closed=${s.alreadyClosed} skipped=${s.skipped} recomputed=${s.recomputed} matches_removed=${s.matchesRemoved}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : 'demo retire failed');
    process.exitCode = 1;
  });
}
