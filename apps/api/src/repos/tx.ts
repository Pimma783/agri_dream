import type pg from 'pg';
import type { Db } from './db.js';

/** A client bound to one open transaction. Repos accept it wherever they accept a Db. */
export type Tx = pg.PoolClient;

export interface TransactionOptions {
  /** Retries after the first attempt (not counting it). Default 3. */
  maxRetries?: number;
  isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  /** Called before each retry; tests use it to observe attempts. */
  onRetry?: (attempt: number, error: unknown) => void;
  /** Delay before retry n (1-based) in ms. Default: 10-30 ms of jitter times n. */
  backoffMs?: (attempt: number) => number;
}

const RETRYABLE = new Set(['40P01', '40001']); // deadlock_detected, serialization_failure

export function isRetryable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && RETRYABLE.has((err as { code?: string }).code ?? '');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn` in one transaction: BEGIN, COMMIT on return, ROLLBACK on throw. The whole function is
 * re-run (on a fresh transaction) when Postgres reports a deadlock or serialization failure, up to
 * `maxRetries` times. `fn` must therefore be free of side effects outside the database.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (tx: Tx) => Promise<T>,
  opts: TransactionOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const backoff = opts.backoffMs ?? ((n: number) => n * (10 + Math.random() * 20));
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    let failure: unknown;
    try {
      await client.query(opts.isolation ? `BEGIN ISOLATION LEVEL ${opts.isolation}` : 'BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      client.release();
      return result;
    } catch (err) {
      failure = err;
      let broken = false;
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true; // connection is unusable: discard it instead of returning it to the pool
      }
      client.release(broken ? true : undefined);
    }
    if (!isRetryable(failure) || attempt >= maxRetries) throw failure;
    opts.onRetry?.(attempt + 1, failure);
    await sleep(backoff(attempt + 1));
  }
}

export type { Db };
