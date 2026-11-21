import { z } from 'zod';
import { type Db, exec, many, maybe, one } from './db.js';

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s: string): string => {
  if (!IDENT.test(s)) throw new Error(`bad identifier: ${s}`);
  return s;
};

/** Make `K` keys required and every other key optional. */
export type Insertable<Row, K extends keyof Row> = Pick<Row, K> & Partial<Omit<Row, K>>;

export interface TableOptions {
  /** jsonb columns: values are JSON.stringify-ed on write (so arrays are not sent as Postgres arrays). */
  json?: readonly string[];
  /** Columns to select instead of `*` (used to skip large bytea content). */
  columns?: readonly string[];
  /** Table has `version` and `updated_at`: update() bumps both. */
  versioned?: boolean;
  /** Table has `version` but no `updated_at`: update() bumps version only. */
  versionOnly?: boolean;
  /** Table has `updated_at` only. */
  touch?: boolean;
  pk?: string;
}

/**
 * Small typed CRUD kit for one table. Identifiers come from code (never from requests) and are
 * checked against a strict pattern; every value goes through a $n parameter.
 */
export function table<S extends z.ZodObject>(name: string, schema: S, opts: TableOptions = {}) {
  type Row = z.infer<S>;
  const t = ident(name);
  const pk = ident(opts.pk ?? 'id');
  const cols = opts.columns ? opts.columns.map(ident).join(', ') : '*';
  const jsonCols = new Set(opts.json ?? []);
  const enc = (k: string, v: unknown) => (jsonCols.has(k) && v !== null && v !== undefined ? JSON.stringify(v) : v);
  const entries = (values: Record<string, unknown>) =>
    Object.entries(values).filter(([, v]) => v !== undefined);

  return {
    name: t,
    schema,
    async insert(db: Db, values: Record<string, unknown>): Promise<Row> {
      const e = entries(values);
      const sql = e.length
        ? `INSERT INTO ${t} (${e.map(([k]) => ident(k)).join(', ')}) VALUES (${e.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${cols}`
        : `INSERT INTO ${t} DEFAULT VALUES RETURNING ${cols}`;
      return one(db, schema, sql, e.map(([k, v]) => enc(k, v)));
    },
    /** INSERT ... ON CONFLICT DO NOTHING. Returns null when a row already existed. */
    async insertIfAbsent(db: Db, values: Record<string, unknown>, conflict = ''): Promise<Row | null> {
      const e = entries(values);
      const target = conflict ? `(${conflict.split(',').map((c) => ident(c.trim())).join(', ')})` : '';
      return maybe(
        db,
        schema,
        `INSERT INTO ${t} (${e.map(([k]) => ident(k)).join(', ')}) VALUES (${e.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT ${target} DO NOTHING RETURNING ${cols}`,
        e.map(([k, v]) => enc(k, v)),
      );
    },
    async get(db: Db, id: string): Promise<Row | null> {
      return maybe(db, schema, `SELECT ${cols} FROM ${t} WHERE ${pk} = $1`, [id]);
    },
    async getForUpdate(db: Db, id: string): Promise<Row | null> {
      return maybe(db, schema, `SELECT ${cols} FROM ${t} WHERE ${pk} = $1 FOR UPDATE`, [id]);
    },
    /**
     * Update the given columns. With `expectedVersion` the row is only changed when the stored version
     * matches (optimistic check); returns null when no row was changed.
     */
    async update(
      db: Db,
      id: string,
      patch: Record<string, unknown>,
      o: { expectedVersion?: number } = {},
    ): Promise<Row | null> {
      const e = entries(patch);
      const sets = e.map(([k], i) => `${ident(k)} = $${i + 1}`);
      if (opts.versioned) sets.push('version = version + 1', 'updated_at = now()');
      else if (opts.versionOnly) sets.push('version = version + 1');
      else if (opts.touch) sets.push('updated_at = now()');
      if (sets.length === 0) throw new Error('empty update');
      const params: unknown[] = e.map(([k, v]) => enc(k, v));
      params.push(id);
      let where = `${pk} = $${params.length}`;
      if (o.expectedVersion !== undefined) {
        params.push(o.expectedVersion);
        where += ` AND version = $${params.length}`;
      }
      return maybe(db, schema, `UPDATE ${t} SET ${sets.join(', ')} WHERE ${where} RETURNING ${cols}`, params);
    },
    /** Equality filter on whitelisted columns, newest first when `orderBy` is given. */
    async where(
      db: Db,
      filter: Record<string, unknown>,
      o: { orderBy?: string; limit?: number } = {},
    ): Promise<Row[]> {
      const e = entries(filter);
      const clause = e.length ? `WHERE ${e.map(([k], i) => `${ident(k)} = $${i + 1}`).join(' AND ')}` : '';
      const order = o.orderBy ? `ORDER BY ${o.orderBy.split(',').map((p) => {
        const [c, d] = p.trim().split(/\s+/);
        return `${ident(c ?? '')} ${d?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;
      }).join(', ')}` : '';
      const limit = o.limit ? `LIMIT ${Math.trunc(o.limit)}` : '';
      return many(db, schema, `SELECT ${cols} FROM ${t} ${clause} ${order} ${limit}`, e.map(([, v]) => v));
    },
    async deleteWhere(db: Db, filter: Record<string, unknown>): Promise<number> {
      const e = entries(filter);
      if (e.length === 0) throw new Error('refusing unfiltered delete');
      return exec(db, `DELETE FROM ${t} WHERE ${e.map(([k], i) => `${ident(k)} = $${i + 1}`).join(' AND ')}`, e.map(([, v]) => v));
    },
  };
}
