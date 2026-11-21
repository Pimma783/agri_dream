import { z } from 'zod';
import { type Db, exec, many, maybe, ts, uuid } from './db.js';
import { type Insertable, table } from './table.js';
export const JobRow = z.object({
  id: uuid,
  kind: z.string(),
  payload: z.unknown(),
  status: z.enum(['QUEUED', 'RUNNING', 'RETRY', 'DONE', 'DEAD']),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  run_at: ts,
  locked_until: ts.nullable(),
  last_error_code: z.string().nullable(),
  dedupe_key: z.string().nullable(),
  created_at: ts,
  updated_at: ts,
});
export type Job = z.infer<typeof JobRow>;
const t = table('jobs', JobRow, { json: ['payload'], touch: true });
export const jobs = {
  /** Enqueue. With a dedupe_key a second enqueue returns null instead of a duplicate job. */
  enqueue: (db: Db, v: Insertable<Job, 'kind' | 'payload'>) => t.insertIfAbsent(db, v, v.dedupe_key ? 'dedupe_key' : ''),
  get: t.get,
  getByDedupeKey: async (db: Db, key: string) => (await t.where(db, { dedupe_key: key }))[0] ?? null,
  /**
   * Claim up to `limit` due jobs with FOR UPDATE SKIP LOCKED, so concurrent workers never get the same
   * row. Due means QUEUED/RETRY with run_at <= now, or RUNNING whose lease ran out. Each claim counts an
   * attempt and sets locked_until = now + leaseMs. Jobs that used all attempts are not claimed again.
   */
  claim: async (db: Db, now: Date, leaseMs: number, limit = 1) =>
    // UPDATE ... RETURNING does not preserve the subquery's ORDER BY, so restore the claim order here.
    (await many(
      db,
      JobRow,
      `UPDATE jobs SET status = 'RUNNING', attempts = attempts + 1, locked_until = $1::timestamptz + ($2 * interval '1 millisecond'), updated_at = now()
       WHERE id IN (
         SELECT id FROM jobs
         WHERE attempts < max_attempts
           AND ((status IN ('QUEUED','RETRY') AND run_at <= $1) OR (status = 'RUNNING' AND locked_until <= $1))
         ORDER BY run_at, id LIMIT $3 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [now, leaseMs, limit],
    )).sort((a, b) => a.run_at.getTime() - b.run_at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  /** Extend the lease of a job this worker still holds. */
  extendLease: async (db: Db, id: string, now: Date, leaseMs: number) =>
    (await exec(
      db,
      `UPDATE jobs SET locked_until = $2::timestamptz + ($3 * interval '1 millisecond'), updated_at = now() WHERE id = $1 AND status = 'RUNNING'`,
      [id, now, leaseMs],
    )) === 1,
  complete: (db: Db, id: string) =>
    maybe(db, JobRow, `UPDATE jobs SET status = 'DONE', locked_until = NULL, updated_at = now() WHERE id = $1 AND status = 'RUNNING' RETURNING *`, [id]),
  retryLater: (db: Db, id: string, runAt: Date, errorCode: string) =>
    maybe(
      db,
      JobRow,
      `UPDATE jobs SET status = 'RETRY', run_at = $2, locked_until = NULL, last_error_code = $3, updated_at = now() WHERE id = $1 AND status = 'RUNNING' RETURNING *`,
      [id, runAt, errorCode],
    ),
  markDead: (db: Db, id: string, errorCode: string) =>
    maybe(
      db,
      JobRow,
      `UPDATE jobs SET status = 'DEAD', locked_until = NULL, last_error_code = $2, updated_at = now() WHERE id = $1 AND status IN ('RUNNING','QUEUED','RETRY') RETURNING *`,
      [id, errorCode],
    ),
  /** RUNNING jobs whose lease expired after the last allowed attempt are never claimed again; park them as DEAD. */
  deadExhausted: (db: Db, now: Date) =>
    many(
      db,
      JobRow,
      `UPDATE jobs SET status = 'DEAD', locked_until = NULL, last_error_code = COALESCE(last_error_code, 'LEASE_EXPIRED'), updated_at = now()
       WHERE status = 'RUNNING' AND attempts >= max_attempts AND locked_until <= $1 RETURNING *`,
      [now],
    ),
};
