// Shared harness for database integration tests (`npm run test:db`, task 4.5).
//
// Isolation strategy: one throw-away Postgres SCHEMA per test file. Each file migrates it from
// scratch, so migrations are exercised on every run, no file sees another file's rows, and nothing
// is left behind (DROP SCHEMA ... CASCADE does not fire the audit_logs append-only triggers, which
// is why TRUNCATE/DELETE cleanup is not used: append-only triggers on audit_logs and quantity_ledger
// refuse it). Within a file use `withRollback` for tests that do not need committed data, or
// `resetData` (drop + re-migrate the schema) between tests that do.
//
// Safety: every entry point goes through `assertTestDatabaseUrl`, which refuses any database whose
// name is not exactly `agrimatch_test` and any non-local host. The harness never touches the
// `public` schema, so the `*.migrations.*.db.test.ts` files that rebuild `public` stay independent.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner as pgMigrateRunner } from 'node-pg-migrate';
import pg from 'pg';
import { createPool } from '../src/repos/index.js';

type RunnerOptions = Parameters<typeof pgMigrateRunner>[0];
const LOCK_WAIT_MS = 120_000;
/**
 * node-pg-migrate with a bounded wait for its advisory lock. Its default mode fails at once when another
 * migration (for example a concurrent test run) holds the lock. Only that one error is retried, for at most
 * two minutes; any other failure, and the lock itself, are unchanged.
 */
export async function runner(options: RunnerOptions): ReturnType<typeof pgMigrateRunner> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      return await pgMigrateRunner(options);
    } catch (e) {
      const busy = e instanceof Error && e.message.includes('Another migration is already running');
      if (!busy || Date.now() >= deadline) throw e;
      await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 250)));
    }
  }
}
export const TEST_DATABASE_NAME = 'agrimatch_test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

/** The value of TEST_DATABASE_URL, or undefined when DB tests are not configured (tests then skip). */
export const testDatabaseUrl: string | undefined = process.env.TEST_DATABASE_URL || undefined;

/** Throws unless `url` is a local connection string for the database named `agrimatch_test`. Never echoes the URL. */
export function assertTestDatabaseUrl(url: string | undefined): string {
  let parsed: URL;
  try {
    parsed = new URL(url ?? '');
  } catch {
    throw new Error('TEST_DATABASE_URL is missing or not a valid URL');
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (dbName !== TEST_DATABASE_NAME) {
    throw new Error(`refusing to run DB tests: database name must be "${TEST_DATABASE_NAME}"`);
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error('refusing to run DB tests: TEST_DATABASE_URL must point at a local host');
  }
  return url as string;
}

const SCHEMA_RE = /^t_[a-f0-9]{16}$/;
function withSearchPath(url: string, schema: string): string {
  const u = new URL(url);
  u.searchParams.set('options', `-c search_path=${schema},public`);
  return u.toString();
}

export interface TestDb {
  /** Pool whose connections all resolve unqualified names inside this file's schema. */
  pool: pg.Pool;
  schema: string;
  /** Connection string pinned to this file's schema (for separate clients/pools). */
  url: string;
  /** Run `fn` inside a transaction that is always rolled back; nothing it writes survives. */
  withRollback<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T>;
  /** Drop and re-migrate this file's private schema (append-only tables cannot be emptied any other way). */
  resetData(): Promise<void>;
  /** Run `fn(tx, index)` in `n` transactions, each on its own new connection. See `runConcurrentTransactions`. */
  concurrently<T>(n: number, fn: (tx: pg.Client, index: number) => Promise<T>): Promise<PromiseSettledResult<T>[]>;
  /** Close the pool and drop the schema. Call from afterAll. */
  close(): Promise<void>;
}

/**
 * Create a fresh migrated schema in the test database and return the harness handle.
 * Fails (before creating anything) unless TEST_DATABASE_URL names `agrimatch_test`; a second check
 * runs `current_database()` on the live connection.
 */
export async function createTestDb(opts: { max?: number } = {}): Promise<TestDb> {
  const base = assertTestDatabaseUrl(testDatabaseUrl);
  const schema = `t_${randomBytes(8).toString('hex')}`;
  if (!SCHEMA_RE.test(schema)) throw new Error('bad schema name'); // identifier is interpolated below
  const url = withSearchPath(base, schema);

  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ db: string }>('SELECT current_database() AS db');
    if (rows[0]?.db !== TEST_DATABASE_NAME) throw new Error('refusing to run DB tests: connected database is not the test database');
    // citext lives in public so every per-file schema can use it through the search_path.
    await admin.query('CREATE EXTENSION IF NOT EXISTS citext SCHEMA public');
    await admin.query(`CREATE SCHEMA ${schema}`);
  } finally {
    await admin.end();
  }

  const dropSchema = async () => {
    const c = new pg.Client({ connectionString: base });
    await c.connect();
    try {
      await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await c.end();
    }
  };

  const migrate = async () => {
    const mig = new pg.Client({ connectionString: url });
    await mig.connect();
    try {
      // `schema` makes node-pg-migrate set search_path and keep pgmigrations inside this schema
      // (its default is public, which would see the public schema's migrations and do nothing).
      await runner({
        dbClient: mig, dir: migrationsDir, schema: [schema, 'public'], migrationsTable: 'pgmigrations', direction: 'up', log: () => {},
      });
      const { rows } = await mig.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = $1 AND tablename = 'organizations'`, [schema]);
      if (rows[0]?.n !== 1) throw new Error('migrations did not create tables in the test schema');
    } finally {
      await mig.end();
    }
  };

  let pool: pg.Pool | undefined;
  try {
    await migrate();
    pool = createPool(url, { max: opts.max ?? 8 });
  } catch (err) {
    await pool?.end();
    await dropSchema();
    throw err;
  }
  const livePool = pool;

  const handle: TestDb = {
    pool: livePool,
    schema,
    url,
    async withRollback(fn) {
      const client = await livePool.connect();
      try {
        await client.query('BEGIN');
        return await fn(client);
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    },
    async resetData() {
      // Append-only tables (audit_logs, quantity_ledger, ...) refuse DELETE/TRUNCATE by design, so
      // rows are never removed: the whole private schema is dropped and migrated again. The pool's
      // connections only carry a search_path, so they keep working across the rebuild.
      const admin = new pg.Client({ connectionString: base });
      await admin.connect();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.query(`CREATE SCHEMA ${schema}`);
      } finally {
        await admin.end();
      }
      await migrate();
    },
    concurrently: (n, fn) => runConcurrentTransactions(url, n, fn),
    async close() {
      await livePool.end();
      await dropSchema();
    },
  };
  return handle;
}

/**
 * Run `fn(tx, i)` for i in 0..n-1, each in its own transaction on its own NEW connection (not from a
 * pool, so the connections are certainly distinct sessions). All n connections are open and in
 * `BEGIN` before any `fn` starts (a barrier), so the callbacks genuinely overlap. A callback that
 * resolves is committed; one that rejects is rolled back. Results are settled, never thrown, so a
 * test can assert exactly how many winners and which error codes the losers got. `fn` runs once per
 * transaction (no retry); use `withTransaction` yourself inside the pool if you want retry semantics.
 */
export async function runConcurrentTransactions<T>(
  connectionString: string,
  n: number,
  fn: (tx: pg.Client, index: number) => Promise<T>,
  opts: { isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' } = {},
): Promise<PromiseSettledResult<T>[]> {
  assertTestDatabaseUrl(connectionString.replace(/\?.*$/, ''));
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('n must be an integer from 1 to 50');
  const clients = Array.from({ length: n }, () => new pg.Client({ connectionString }));
  try {
    await Promise.all(clients.map((c) => c.connect()));
    await Promise.all(clients.map((c) => c.query(opts.isolation ? `BEGIN ISOLATION LEVEL ${opts.isolation}` : 'BEGIN')));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const runs = clients.map(async (c, i) => {
      await gate;
      try {
        const out = await fn(c, i);
        await c.query('COMMIT');
        return out;
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
      }
    });
    release();
    return await Promise.allSettled(runs);
  } finally {
    await Promise.all(clients.map((c) => c.end().catch(() => {})));
  }
}

/**
 * Run `fn(i)` n times at once through the pool (each call typically opens its own `withTransaction`,
 * as a service would) and wait for all to settle. Use for service-level races such as two accepts of one offer.
 */
export async function runConcurrently<T>(n: number, fn: (index: number) => Promise<T>): Promise<PromiseSettledResult<T>[]> {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const runs = Array.from({ length: n }, async (_, i) => {
    await gate;
    return fn(i);
  });
  release();
  return Promise.allSettled(runs);
}
