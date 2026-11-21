import pg from 'pg';
import { z } from 'zod';

/** Anything that can run a query: the pool or a checked-out transaction client. */
export type Db = pg.Pool | pg.PoolClient;

const DATE_OID = 1082;

/** Pool config. numeric stays a string (pg default); `date` stays 'YYYY-MM-DD' instead of a local-time Date. */
export function createPool(connectionString: string, opts: { max?: number } = {}): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    types: {
      getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
        oid === DATE_OID ? (v: string) => v : pg.types.getTypeParser(oid, format as 'text')) as never,
    },
  });
}

// Shared Zod building blocks. Decimals are strings end to end; never convert to number.
export const uuid = z.uuid();
export const dec = z.string().regex(/^-?\d+(\.\d+)?$/, 'decimal string');
export const ts = z.date();
export const json = z.record(z.string(), z.unknown());
export const jsonAny = z.unknown();
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Run a query and validate every returned row with `schema`. */
export async function many<S extends z.ZodType>(
  db: Db,
  schema: S,
  sql: string,
  params: readonly unknown[] = [],
): Promise<z.infer<S>[]> {
  const res = await db.query(sql, params as unknown[]);
  return res.rows.map((r) => schema.parse(r));
}

export async function maybe<S extends z.ZodType>(
  db: Db,
  schema: S,
  sql: string,
  params: readonly unknown[] = [],
): Promise<z.infer<S> | null> {
  return (await many(db, schema, sql, params))[0] ?? null;
}

export async function one<S extends z.ZodType>(
  db: Db,
  schema: S,
  sql: string,
  params: readonly unknown[] = [],
): Promise<z.infer<S>> {
  const row = await maybe(db, schema, sql, params);
  if (row === null) throw new Error('expected one row, got none');
  return row;
}

/** Row count of a statement that returns no rows we care about. */
export async function exec(db: Db, sql: string, params: readonly unknown[] = []): Promise<number> {
  return (await db.query(sql, params as unknown[])).rowCount ?? 0;
}

/** The database clock at this instant (clock_timestamp, not the transaction start), for expiry checks after lock waits. */
export async function dbNow(db: Db): Promise<Date> {
  return (await one(db, z.object({ now: ts }), 'SELECT clock_timestamp() AS now')).now;
}
