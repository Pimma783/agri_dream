import { z } from 'zod';
import { type Db, exec, many, maybe, ts, uuid } from './db.js';
import { lineChannel } from './enums.js';
import { type Insertable, table } from './table.js';
export const OutboxRow = z.object({
  id: uuid,
  channel: lineChannel,
  to_line_identity_id: uuid,
  message: z.unknown(),
  retry_key: uuid,
  status: z.enum(['PENDING', 'SENDING', 'SENT', 'RETRY', 'DEAD']),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  next_attempt_at: ts,
  locked_until: ts.nullable(),
  last_error_code: z.string().nullable(),
  dedupe_key: z.string(),
  related_type: z.string().nullable(),
  related_id: uuid.nullable(),
  created_at: ts,
  sent_at: ts.nullable(),
});
export type OutboxMessage = z.infer<typeof OutboxRow>;
const t = table('notification_outbox', OutboxRow, { json: ['message'] });
export const outbox = {
  /** Insert inside the business transaction. Returns null when this dedupe_key was already queued. */
  enqueue: (db: Db, v: Insertable<OutboxMessage, 'channel' | 'to_line_identity_id' | 'message' | 'dedupe_key'>) =>
    t.insertIfAbsent(db, v, 'dedupe_key'),
  get: t.get,
  getByDedupeKey: async (db: Db, key: string) => (await t.where(db, { dedupe_key: key }))[0] ?? null,
  listByRelated: (db: Db, relatedType: string, relatedId: string) =>
    many(db, OutboxRow, 'SELECT * FROM notification_outbox WHERE related_type = $1 AND related_id = $2 ORDER BY created_at, id', [relatedType, relatedId]),
  /** Claim due rows with FOR UPDATE SKIP LOCKED and a lease; each claim counts an attempt. */
  claim: async (db: Db, now: Date, leaseMs: number, limit = 10) =>
    // UPDATE ... RETURNING does not preserve the subquery's ORDER BY, so restore the claim order here.
    (await many(
      db,
      OutboxRow,
      `UPDATE notification_outbox SET status = 'SENDING', attempts = attempts + 1, locked_until = $1::timestamptz + ($2 * interval '1 millisecond')
       WHERE id IN (
         SELECT id FROM notification_outbox
         WHERE attempts < max_attempts
           AND ((status IN ('PENDING','RETRY') AND next_attempt_at <= $1) OR (status = 'SENDING' AND locked_until <= $1))
         ORDER BY next_attempt_at, id LIMIT $3 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [now, leaseMs, limit],
    )).sort((a, b) => a.next_attempt_at.getTime() - b.next_attempt_at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  markSent: (db: Db, id: string, at: Date) =>
    maybe(db, OutboxRow, `UPDATE notification_outbox SET status = 'SENT', sent_at = $2, locked_until = NULL WHERE id = $1 AND status = 'SENDING' RETURNING *`, [id, at]),
  retryLater: (db: Db, id: string, at: Date, errorCode: string) =>
    maybe(
      db,
      OutboxRow,
      `UPDATE notification_outbox SET status = 'RETRY', next_attempt_at = $2, locked_until = NULL, last_error_code = $3 WHERE id = $1 AND status = 'SENDING' RETURNING *`,
      [id, at, errorCode],
    ),
  markDead: (db: Db, id: string, errorCode: string) =>
    maybe(
      db,
      OutboxRow,
      `UPDATE notification_outbox SET status = 'DEAD', locked_until = NULL, last_error_code = $2 WHERE id = $1 AND status IN ('SENDING','PENDING','RETRY') RETURNING *`,
      [id, errorCode],
    ),
  countByStatus: (db: Db, status: OutboxMessage['status']) =>
    exec(db, 'SELECT 1 FROM notification_outbox WHERE status = $1', [status]),
  /** Rows stuck in SENDING after the last allowed attempt (lease expired) are never claimed again; park them as DEAD. */
  deadExhausted: (db: Db, now: Date) =>
    many(
      db,
      OutboxRow,
      `UPDATE notification_outbox SET status = 'DEAD', locked_until = NULL, last_error_code = COALESCE(last_error_code, 'LEASE_EXPIRED')
       WHERE status = 'SENDING' AND attempts >= max_attempts AND locked_until <= $1 RETURNING *`,
      [now],
    ),
};
