// Idempotency-Key handling over idempotency_keys(org_id, scope, key, request_hash, response).
// Same key and same request: replay the stored response. Same key, different request: IDEMPOTENCY_MISMATCH.
// The key row and the work commit in one transaction, so a failed attempt leaves nothing behind
// and a concurrent duplicate waits on the unique key, then replays the committed response.
import { createHash } from 'node:crypto';
import { idempotencyKeys, type Tx } from '../repos/index.js';
import { inTransaction, type ServiceContext } from './context.js';
import { appError } from './errors.js';
import { err, ok, type Result } from './result.js';

/** Deterministic JSON: object keys sorted, so equal requests hash equally. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

export const requestHash = (request: unknown): string =>
  createHash('sha256').update(stableStringify(request)).digest('hex');

export interface IdempotencyInput {
  orgId: string;
  /** Operation name, e.g. `draft.publish:<draftId>`. */
  scope: string;
  key: string;
  /** Everything that defines the request (ids, expectedVersion, body). */
  request: unknown;
}

export interface Idempotent<T> {
  value: T;
  replayed: boolean;
}

/**
 * Run `fn` once per (org, scope, key). `T` must be JSON-serializable since it is stored and replayed.
 * An Err result is not stored: the transaction rolls back and the client may retry with the same key.
 */
export async function withIdempotency<T>(
  ctx: Pick<ServiceContext, 'pool'>,
  input: IdempotencyInput,
  fn: (tx: Tx) => Promise<Result<T>>,
): Promise<Result<Idempotent<T>>> {
  const hash = requestHash(input.request);
  return inTransaction<Idempotent<T>>(ctx, async (tx) => {
    const claimed = await idempotencyKeys.begin(tx, input.orgId, input.scope, input.key, hash);
    if (!claimed) {
      const existing = await idempotencyKeys.get(tx, input.orgId, input.scope, input.key);
      if (existing) {
        if (existing.request_hash !== hash) return err(appError('IDEMPOTENCY_MISMATCH'));
        if (existing.response !== null && existing.response !== undefined) {
          return ok<Idempotent<T>>({ value: existing.response as T, replayed: true });
        }
      }
      // Row exists without a response (should not happen: claim and response commit together).
      return err(appError('CONFLICT_RETRY'));
    }
    const r = await fn(tx);
    if (!r.ok) return r;
    await idempotencyKeys.saveResponse(tx, input.orgId, input.scope, input.key, r.value);
    return ok<Idempotent<T>>({ value: r.value, replayed: false });
  });
}
