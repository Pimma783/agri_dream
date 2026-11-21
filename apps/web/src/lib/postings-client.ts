import {
  balingServiceSchema,
  draftViewSchema,
  publishResultSchema,
  purchaseDemandSchema,
  type DraftView,
  type FormDraftKind,
  type PostingAction,
  type PublishResult,
} from '@agrimatch/contracts';
import { browserApi } from './api';
import type { ApiCore } from './api-core';

export type PostingsApi = Pick<ApiCore, 'post' | 'patch'>;
export type PostingResource = 'purchase-demands' | 'baling-services';

/** POST /api/drafts, then PATCH with `expectedVersion` for every later change. */
export async function saveDraft(
  api: PostingsApi,
  kind: FormDraftKind,
  draft: DraftView | null,
  patch: Record<string, unknown>,
): Promise<DraftView> {
  if (!draft) return api.post('/drafts', draftViewSchema, { kind, patch });
  return api.patch(`/drafts/${draft.draft.id}`, draftViewSchema, { expectedVersion: draft.draft.version, patch });
}

/** Human confirmation. The same key is reused for the same draft version so a retry cannot publish twice. */
export function publishDraft(api: PostingsApi, draft: DraftView, idempotencyKey: string): Promise<PublishResult> {
  return api.post(`/drafts/${draft.draft.id}/publish`, publishResultSchema, { expectedVersion: draft.draft.version }, {
    'Idempotency-Key': idempotencyKey,
  });
}

export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** pause, open, close or cancel a published demand or baling service. */
export function changePostingStatus(
  api: PostingsApi,
  resource: PostingResource,
  id: string,
  action: PostingAction,
  expectedVersion: number,
) {
  const schema = resource === 'purchase-demands' ? purchaseDemandSchema : balingServiceSchema;
  return api.post(`/${resource}/${id}/${action}`, schema, { expectedVersion });
}

export const defaultPostingsApi: PostingsApi = browserApi;
