import { z } from 'zod';
import { type Db, maybe, ts, uuid } from './db.js';
export const IdempotencyKeyRow = z.object({
  org_id: uuid,
  scope: z.string(),
  key: z.string(),
  request_hash: z.string(),
  response: z.unknown(),
  created_at: ts,
});
export type IdempotencyKey = z.infer<typeof IdempotencyKeyRow>;
export const idempotencyKeys = {
  get: (db: Db, orgId: string, scope: string, key: string) =>
    maybe(db, IdempotencyKeyRow, 'SELECT * FROM idempotency_keys WHERE org_id = $1 AND scope = $2 AND key = $3', [orgId, scope, key]),
  /** Claim the key. Returns the new row, or null when the key already exists (read it with `get`). */
  begin: (db: Db, orgId: string, scope: string, key: string, requestHash: string) =>
    maybe(
      db,
      IdempotencyKeyRow,
      `INSERT INTO idempotency_keys (org_id, scope, key, request_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, scope, key) DO NOTHING RETURNING *`,
      [orgId, scope, key, requestHash],
    ),
  /** Store the response to replay for later requests with the same key. */
  saveResponse: (db: Db, orgId: string, scope: string, key: string, response: unknown) =>
    maybe(
      db,
      IdempotencyKeyRow,
      'UPDATE idempotency_keys SET response = $4 WHERE org_id = $1 AND scope = $2 AND key = $3 RETURNING *',
      [orgId, scope, key, JSON.stringify(response)],
    ),
};
