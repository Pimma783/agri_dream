// Shared status lifecycle for published listings, demands, baling services and baling requests:
// pause, open (resume), close and cancel with expectedVersion, an audit row and a match recompute.
// Transitions come from domain/state/draft.ts (`next`); the DB CHECK on `status` is the backstop.
import { z } from 'zod';
import type { Actor, Capability } from '../domain/permissions.js';
import { draftMachine } from '../domain/state/index.js';
import type { Db, Tx } from '../repos/index.js';
import { audit } from './audit.js';
import { authorized, checkVersion, inTransaction, type ServiceContext } from './context.js';
import { appError } from './errors.js';
import { enqueueRecompute, type MatchEntityType } from './recompute.js';
import { err, ok, type Result } from './result.js';

export type PublishedStatus = 'PUBLISHED' | 'PAUSED' | 'CLOSED' | 'CANCELLED';

export interface ManagedRow {
  id: string;
  org_id: string;
  status: PublishedStatus;
  version: number;
}

export interface ManagedRepo<R extends ManagedRow> {
  get(db: Db, id: string): Promise<R | null>;
  getForUpdate(db: Db, id: string): Promise<R | null>;
  update(db: Db, id: string, patch: { status: PublishedStatus }, o?: { expectedVersion?: number }): Promise<R | null>;
  listByOrg(db: Db, orgId: string): Promise<R[]>;
}

export interface LifecycleConfig<R extends ManagedRow> {
  capability: Capability;
  repo: ManagedRepo<R>;
  /** Audit `entity_type`, e.g. `listing`. */
  auditType: string;
  matchType: MatchEntityType;
  /** Runs in the same transaction after a close or cancel (e.g. releasing a resale reservation). */
  onEnd?: (tx: Tx, before: R, after: R) => Promise<void>;
}

export interface TransitionInput {
  id: string;
  expectedVersion: number;
}

const InputSchema = z.object({ id: z.uuid(), expectedVersion: z.number().int().min(1) }).strict();

export interface LifecycleService<R extends ManagedRow> {
  get(actor: Actor, id: string): Promise<Result<R>>;
  list(actor: Actor): Promise<Result<R[]>>;
  pause(actor: Actor, input: TransitionInput): Promise<Result<R>>;
  /** PAUSED -> PUBLISHED. */
  open(actor: Actor, input: TransitionInput): Promise<Result<R>>;
  close(actor: Actor, input: TransitionInput): Promise<Result<R>>;
  cancel(actor: Actor, input: TransitionInput): Promise<Result<R>>;
}

export function createLifecycleService<R extends ManagedRow>(
  ctx: ServiceContext,
  cfg: LifecycleConfig<R>,
): LifecycleService<R> {
  async function transition(actor: Actor, input: TransitionInput, event: draftMachine.DraftEvent, action: string): Promise<Result<R>> {
    // The assistant is draft-only: it never pauses, closes or cancels anything (Requirement 5.1).
    if (actor.channel === 'assistant') return err(appError('FORBIDDEN'));
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) return err(appError('VALIDATION', { fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }));
    const { id, expectedVersion } = parsed.data;
    const pre = await cfg.repo.get(ctx.pool, id);
    return authorized(ctx, actor, cfg.capability, pre ? { orgId: pre.org_id } : undefined, () =>
      inTransaction(ctx, async (tx) => {
        const row = await cfg.repo.getForUpdate(tx, id);
        if (!row || row.org_id !== actor.orgId) return err(appError('NOT_FOUND'));
        const v = checkVersion(expectedVersion, row.version);
        if (!v.ok) return err(v.error);
        const t = draftMachine.next(row.status, event);
        if (!t.ok) return err(appError('INVALID_STATE', { details: { state: row.status } }));
        const updated = await cfg.repo.update(tx, id, { status: t.state as PublishedStatus }, { expectedVersion });
        if (!updated) return err(appError('STALE_VERSION'));
        if (cfg.onEnd && (event === 'CLOSE' || event === 'CANCEL')) await cfg.onEnd(tx, row, updated);
        await audit(tx, actor, {
          action: `${cfg.auditType}.${action}`,
          entityType: cfg.auditType,
          entityId: id,
          entityVersion: updated.version,
          detail: { from: row.status, to: updated.status },
        });
        await enqueueRecompute(tx, { entity_type: cfg.matchType, entity_id: id, version: updated.version });
        return ok(updated);
      }),
    );
  }

  return {
    get: async (actor, id) => {
      if (!z.uuid().safeParse(id).success) return err(appError('NOT_FOUND'));
      const row = await cfg.repo.get(ctx.pool, id);
      return authorized(ctx, actor, cfg.capability, row ? { orgId: row.org_id } : undefined, async () =>
        row && row.org_id === actor.orgId ? ok(row) : err(appError('NOT_FOUND')),
      );
    },
    list: (actor) =>
      authorized(ctx, actor, cfg.capability, { orgId: actor.orgId }, async () => ok(await cfg.repo.listByOrg(ctx.pool, actor.orgId))),
    pause: (actor, input) => transition(actor, input, 'PAUSE', 'paused'),
    open: (actor, input) => transition(actor, input, 'RESUME', 'opened'),
    close: (actor, input) => transition(actor, input, 'CLOSE', 'closed'),
    cancel: (actor, input) => transition(actor, input, 'CANCEL', 'cancelled'),
  };
}
