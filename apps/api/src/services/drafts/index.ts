// Layer: services. Drafts (Requirement 5): create, patch with expectedVersion, cancel, and publish.
// Publishing is a human action: the assistant channel may create and patch drafts but never publish,
// cancel, or change a published entity (Requirement 5.1). Publishing the same version twice returns the
// same entity and creates one row (Requirement 5.8).
import { z } from 'zod';
import { type Actor, authorize, type Capability } from '../../domain/permissions.js';
import { draftMachine } from '../../domain/state/index.js';
import { type Draft, drafts } from '../../repos/index.js';
import { audit } from '../audit.js';
import { authorized, checkVersion, inTransaction, registerService, type ServiceContext } from '../context.js';
import { appError, type FieldIssue } from '../errors.js';
import { withIdempotency } from '../idempotency.js';
import { enqueueRecompute, type MatchEntityType } from '../recompute.js';
import { err, ok, type Result } from '../result.js';
import { checkResalePublishable, linkAllocationToListing, releaseForDraft, resizeForDraft } from '../resale/allocation.js';
import { createEntityFromDraft, type PublishedEntityType } from './publish.js';
import { completeness, consistencyIssues, DRAFT_KINDS, type DraftKind, mergeData, normalizePatch } from './schemas.js';

export { DRAFT_KINDS, completeness, normalizePatch } from './schemas.js';
export type { DraftKind, DraftPatchInput } from './schemas.js';

/** Capability to start a draft of each kind. Resale drafts start from an agreement (task 10), not here. */
const CREATE_CAPABILITY: Readonly<Record<Exclude<DraftKind, 'RESALE_LISTING'>, Capability>> = {
  SALE_LISTING: 'LISTING_CREATE',
  PURCHASE_DEMAND: 'DEMAND_CREATE',
  BALING_SERVICE: 'BALING_SERVICE_PUBLISH',
  BALING_REQUEST: 'BALING_REQUEST_SUBMIT',
};
/** Capability to work on an existing draft (patch, cancel, publish). */
const MANAGE_CAPABILITY: Readonly<Record<DraftKind, Capability>> = {
  SALE_LISTING: 'LISTING_MANAGE',
  RESALE_LISTING: 'LISTING_MANAGE',
  PURCHASE_DEMAND: 'DEMAND_MANAGE',
  BALING_SERVICE: 'BALING_SERVICE_MANAGE',
  BALING_REQUEST: 'BALING_REQUEST_SUBMIT',
};
const MATCH_TYPE: Readonly<Record<PublishedEntityType, MatchEntityType>> = {
  LISTING: 'LISTING', DEMAND: 'DEMAND', BALING_SERVICE: 'BALING_SERVICE', BALING_REQUEST: 'BALING_REQUEST',
};

registerService('drafts.sale_listing', 'LISTING_MANAGE');
registerService('drafts.resale_listing', 'LISTING_MANAGE');
registerService('drafts.purchase_demand', 'DEMAND_MANAGE');
registerService('drafts.baling_service', 'BALING_SERVICE_MANAGE');
registerService('drafts.baling_request', 'BALING_REQUEST_SUBMIT');

export interface DraftView {
  draft: Draft;
  complete: boolean;
  /** Fields still missing or invalid. Computed on every read, never stored. */
  missing_fields: string[];
}

export interface PublishResult {
  draft_id: string;
  entity_type: PublishedEntityType;
  entity_id: string;
  /** The draft version that was confirmed. */
  draft_version: number;
}

export interface DraftService {
  create(actor: Actor, input: { kind: DraftKind; patch?: unknown }): Promise<Result<DraftView>>;
  get(actor: Actor, id: string): Promise<Result<DraftView>>;
  list(actor: Actor): Promise<Result<DraftView[]>>;
  /** Merge `patch` into the draft. Fails with STALE_VERSION unless `expectedVersion` is the current version. */
  patch(actor: Actor, input: { draftId: string; expectedVersion: number; patch: unknown }): Promise<Result<DraftView>>;
  cancel(actor: Actor, input: { draftId: string; expectedVersion: number }): Promise<Result<DraftView>>;
  /** Human confirmation only. `replayed` is true when this call returned an earlier result. */
  publish(
    actor: Actor,
    input: { draftId: string; expectedVersion: number; idempotencyKey?: string },
  ): Promise<Result<PublishResult & { replayed: boolean }>>;
}

const IdSchema = z.uuid();
const VersionSchema = z.number().int().min(1);
const KeySchema = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);

const view = (draft: Draft): DraftView => {
  const c = completeness(draft.kind, draft.data);
  return { draft, complete: c.complete, missing_fields: c.missing };
};

const validation = (fields: readonly FieldIssue[]) => err(appError('VALIDATION', { fields }));

/** Status after a data change: a reviewed draft goes back to DRAFT, then forward again when complete. */
function statusAfterEdit(current: Draft['status'], complete: boolean): Draft['status'] {
  let s = current;
  if (s === 'AWAITING_REVIEW') {
    const r = draftMachine.next(s, 'EDIT');
    if (r.ok) s = r.state as Draft['status'];
  }
  if (complete && s === 'DRAFT') {
    const r = draftMachine.next(s, 'COMPLETE');
    if (r.ok) s = r.state as Draft['status'];
  }
  return s;
}

const sameData = (a: unknown, b: unknown): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, sortKeys(x)]));
  }
  return v;
}

export function createDraftService(ctx: ServiceContext): DraftService {
  /** Read the draft, hide other organizations' drafts as NOT_FOUND, then check the capability for its kind. */
  async function withOwnedDraft<T>(actor: Actor, id: string, fn: () => Promise<Result<T>>): Promise<Result<T>> {
    if (!IdSchema.safeParse(id).success) return err(appError('NOT_FOUND'));
    const row = await drafts.get(ctx.pool, id);
    if (!row || row.org_id !== actor.orgId) return err(appError('NOT_FOUND'));
    return authorized(ctx, actor, MANAGE_CAPABILITY[row.kind], { orgId: row.org_id }, fn);
  }

  /** Lock the row inside the transaction and re-check ownership. */
  async function lockOwned(tx: Parameters<Parameters<typeof inTransaction>[1]>[0], actor: Actor, id: string): Promise<Draft | null> {
    const row = await drafts.getForUpdate(tx, id);
    return row && row.org_id === actor.orgId ? row : null;
  }

  async function create(actor: Actor, input: { kind: DraftKind; patch?: unknown }): Promise<Result<DraftView>> {
    const kind = input?.kind;
    if (!DRAFT_KINDS.includes(kind)) return validation([{ path: 'kind', message: 'UNKNOWN_KIND' }]);
    if (kind === 'RESALE_LISTING') return validation([{ path: 'kind', message: 'RESALE_FROM_AGREEMENT_ONLY' }]);
    return authorized(ctx, actor, CREATE_CAPABILITY[kind], undefined, async () => {
      let data: Record<string, unknown> = {};
      if (input.patch !== undefined) {
        const n = normalizePatch(kind, input.patch);
        if (!n.ok) return validation(n.issues);
        data = mergeData(kind, data, n.fields);
        const bad = consistencyIssues(kind, data);
        if (bad.length) return validation(bad);
      }
      const complete = completeness(kind, data).complete;
      return inTransaction(ctx, async (tx) => {
        const row = await drafts.insert(tx, {
          org_id: actor.orgId, created_by: actor.userId, kind, data, status: statusAfterEdit('DRAFT', complete),
        });
        await audit(tx, actor, {
          action: 'draft.created', entityType: 'draft', entityId: row.id, entityVersion: row.version, detail: { kind },
        });
        return ok(view(row));
      });
    });
  }

  async function patch(actor: Actor, input: { draftId: string; expectedVersion: number; patch: unknown }): Promise<Result<DraftView>> {
    if (!VersionSchema.safeParse(input?.expectedVersion).success) return validation([{ path: 'expectedVersion', message: 'INVALID_VALUE' }]);
    return withOwnedDraft(actor, input.draftId, () =>
      inTransaction(ctx, async (tx) => {
        const row = await lockOwned(tx, actor, input.draftId);
        if (!row) return err(appError('NOT_FOUND'));
        const v = checkVersion(input.expectedVersion, row.version);
        if (!v.ok) return err(v.error);
        if (row.status === 'PUBLISHED' || row.status === 'CANCELLED') {
          return err(appError('INVALID_STATE', { details: { state: row.status } }));
        }
        const n = normalizePatch(row.kind, input.patch);
        if (!n.ok) return validation(n.issues);
        if (Object.keys(n.fields).length === 0) return validation([{ path: 'patch', message: 'EMPTY_PATCH' }]);
        const data = mergeData(row.kind, row.data, n.fields);
        const bad = consistencyIssues(row.kind, data);
        if (bad.length) return validation(bad);
        // A patch that changes nothing keeps the version, so a pending confirmation stays valid.
        if (sameData(data, row.data)) return ok(view(row));
        const status = statusAfterEdit(row.status, completeness(row.kind, data).complete);
        const updated = await drafts.update(tx, row.id, { data, status }, { expectedVersion: input.expectedVersion });
        if (!updated) return err(appError('STALE_VERSION'));
        if (row.kind === 'RESALE_LISTING' && typeof n.fields.qty_kg === 'string') {
          const re = await resizeForDraft(tx, row.id, n.fields.qty_kg); // Requirement 14.5: re-check the cap on edit
          if (!re.ok) return err(re.error);
        }
        await audit(tx, actor, {
          action: 'draft.patched', entityType: 'draft', entityId: row.id, entityVersion: updated.version,
          detail: { kind: row.kind, fields: Object.keys(n.fields).sort(), status },
        });
        return ok(view(updated));
      }),
    );
  }

  async function cancel(actor: Actor, input: { draftId: string; expectedVersion: number }): Promise<Result<DraftView>> {
    if (actor.channel === 'assistant') return err(appError('FORBIDDEN'));
    if (!VersionSchema.safeParse(input?.expectedVersion).success) return validation([{ path: 'expectedVersion', message: 'INVALID_VALUE' }]);
    return withOwnedDraft(actor, input.draftId, () =>
      inTransaction(ctx, async (tx) => {
        const row = await lockOwned(tx, actor, input.draftId);
        if (!row) return err(appError('NOT_FOUND'));
        const v = checkVersion(input.expectedVersion, row.version);
        if (!v.ok) return err(v.error);
        // A published draft is tied to its entity (DB check draft_published_shape), so it cannot be cancelled.
        const t = row.status === 'PUBLISHED' ? { ok: false as const } : draftMachine.next(row.status, 'CANCEL');
        if (!t.ok) return err(appError('INVALID_STATE', { details: { state: row.status } }));
        const updated = await drafts.update(tx, row.id, { status: t.state as Draft['status'] }, { expectedVersion: input.expectedVersion });
        if (!updated) return err(appError('STALE_VERSION'));
        if (row.kind === 'RESALE_LISTING') await releaseForDraft(tx, row.id); // A10: discarded draft frees its reservation
        await audit(tx, actor, {
          action: 'draft.cancelled', entityType: 'draft', entityId: row.id, entityVersion: updated.version, detail: { kind: row.kind },
        });
        return ok(view(updated));
      }),
    );
  }

  async function publish(
    actor: Actor,
    input: { draftId: string; expectedVersion: number; idempotencyKey?: string },
  ): Promise<Result<PublishResult & { replayed: boolean }>> {
    // Requirement 5.1: only a person publishes. The assistant has no path to this function.
    if (actor.channel === 'assistant') {
      ctx.logger?.warn({ capability: 'draft.publish', channel: actor.channel }, 'authorization denied');
      return err(appError('FORBIDDEN'));
    }
    if (!VersionSchema.safeParse(input?.expectedVersion).success) return validation([{ path: 'expectedVersion', message: 'INVALID_VALUE' }]);
    if (input.idempotencyKey !== undefined && !KeySchema.safeParse(input.idempotencyKey).success) {
      return validation([{ path: 'Idempotency-Key', message: 'INVALID_VALUE' }]);
    }
    const { draftId, expectedVersion } = input;
    let already = false;

    /** Runs under the draft's row lock, inside one transaction. */
    const run = async (tx: Parameters<Parameters<typeof inTransaction>[1]>[0]): Promise<Result<PublishResult>> => {
      const row = await lockOwned(tx, actor, draftId);
      if (!row) return err(appError('NOT_FOUND'));
      const v = checkVersion(expectedVersion, row.version);
      if (!v.ok) return err(v.error); // Requirement 5.5: nothing is created for a stale version
      if (row.status === 'PUBLISHED' && row.published_entity_type && row.published_entity_id) {
        already = true; // Requirement 5.8: same version again returns the same entity
        return ok({
          draft_id: row.id, entity_type: row.published_entity_type, entity_id: row.published_entity_id, draft_version: row.version,
        });
      }
      const c = completeness(row.kind, row.data);
      if (row.status === 'DRAFT') {
        return c.complete
          ? err(appError('INVALID_STATE', { details: { state: row.status } }))
          : validation(c.missing.map((path) => ({ path, message: 'REQUIRED' })));
      }
      const t = draftMachine.next(row.status, 'PUBLISH');
      if (!t.ok) return err(appError('INVALID_STATE', { details: { state: row.status } }));
      if (!c.complete) return validation(c.missing.map((path) => ({ path, message: 'REQUIRED' })));
      let allocationId: string | null = null;
      if (row.kind === 'RESALE_LISTING') {
        // Requirement 14.5: the listing quantity can never exceed what the source agreement reserved for it.
        const q = typeof row.data.qty_kg === 'string' ? row.data.qty_kg : '0';
        const chk = await checkResalePublishable(tx, row.id, q);
        if (!chk.ok) return err(chk.error);
        allocationId = chk.value.id;
      }
      const entity = await createEntityFromDraft(tx, row, row.kind, row.data);
      if (allocationId) await linkAllocationToListing(tx, allocationId, entity.id);
      const marked = await drafts.markPublished(tx, row.id, expectedVersion, entity.type, entity.id);
      if (!marked) return err(appError('STALE_VERSION'));
      await audit(tx, actor, {
        action: 'draft.published', entityType: 'draft', entityId: row.id, entityVersion: row.version,
        detail: { kind: row.kind, entity_type: entity.type, entity_id: entity.id },
      });
      await enqueueRecompute(tx, { entity_type: MATCH_TYPE[entity.type], entity_id: entity.id, version: 1 });
      return ok({ draft_id: row.id, entity_type: entity.type, entity_id: entity.id, draft_version: row.version });
    };

    return withOwnedDraft(actor, draftId, async () => {
      if (input.idempotencyKey === undefined) {
        const r = await inTransaction(ctx, run);
        return r.ok ? ok({ ...r.value, replayed: already }) : r;
      }
      const r = await withIdempotency(
        ctx,
        { orgId: actor.orgId, scope: `draft.publish:${draftId}`, key: input.idempotencyKey, request: { draftId, expectedVersion } },
        run,
      );
      return r.ok ? ok({ ...r.value.value, replayed: r.value.replayed || already }) : r;
    });
  }

  return {
    create,
    patch,
    cancel,
    publish,
    get: (actor, id) => withOwnedDraft(actor, id, async () => {
      const row = await drafts.get(ctx.pool, id);
      return row && row.org_id === actor.orgId ? ok(view(row)) : err(appError('NOT_FOUND'));
    }),
    async list(actor) {
      const rows = await drafts.listByOrg(ctx.pool, actor.orgId);
      // Only drafts of kinds this actor may manage; a role with none gets an empty list.
      return ok(rows.filter((r) => authorize(actor, MANAGE_CAPABILITY[r.kind], { orgId: r.org_id }).allowed).map(view));
    },
  };
}
