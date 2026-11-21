// Shared service plumbing: every service function takes (actor, input) and calls authorize() first.
import type pg from 'pg';
import type { Logger } from 'pino';
import {
  type Actor,
  authorize,
  type Capability,
  type Resource,
  serviceRegistry,
} from '../domain/permissions.js';
import { isRetryable, type Tx, withTransaction } from '../repos/index.js';
import { appError, type AppError } from './errors.js';
import { err, type Result } from './result.js';

export interface ServiceContext {
  pool: pg.Pool;
  now?: () => Date;
  logger?: Logger;
}

export const nowOf = (ctx: ServiceContext): Date => (ctx.now ?? (() => new Date()))();

/** Declare a service and the capability it enforces. Returns the name for convenience. */
export function registerService(name: string, capability: Capability): string {
  serviceRegistry.register(name, capability);
  return name;
}

/**
 * Authorize first, then run `fn`. A role violation is FORBIDDEN (logged at warn, no payload); a resource
 * outside the actor's organization is NOT_FOUND, identical to a missing resource.
 */
export async function authorized<T>(
  ctx: Pick<ServiceContext, 'logger'>,
  actor: Actor,
  capability: Capability,
  resource: Resource | undefined,
  fn: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const decision = authorize(actor, capability, resource);
  if (!decision.allowed) {
    if (decision.code === 'FORBIDDEN') {
      ctx.logger?.warn({ capability, role: actor.role, channel: actor.channel }, 'authorization denied');
    }
    return err(appError(decision.code));
  }
  return fn();
}

/** Thrown inside a transaction to roll it back while carrying an error result out. */
class Rollback extends Error {
  constructor(readonly error: AppError) {
    super(error.code);
  }
}

/**
 * Run `fn` in one transaction. An Err result rolls everything back; Ok commits. Deadlocks and
 * serialization failures are retried by withTransaction (3 times), then surface as CONFLICT_RETRY.
 */
export async function inTransaction<T>(
  ctx: Pick<ServiceContext, 'pool'>,
  fn: (tx: Tx) => Promise<Result<T>>,
): Promise<Result<T>> {
  try {
    return await withTransaction(ctx.pool, async (tx) => {
      const r = await fn(tx);
      if (!r.ok) throw new Rollback(r.error);
      return r;
    });
  } catch (e) {
    if (e instanceof Rollback) return err(e.error);
    if (isRetryable(e)) return err(appError('CONFLICT_RETRY'));
    throw e;
  }
}

/** Optimistic concurrency: a write carries `expectedVersion`; a mismatch is STALE_VERSION with the current version. */
export function checkVersion(expected: number, current: number): Result<true> {
  return expected === current
    ? { ok: true, value: true }
    : err(appError('STALE_VERSION', { details: { current_version: current } }));
}
