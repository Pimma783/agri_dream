// Layer: services. Image upload with queued assessment, and the assessment store (Requirement 8).
// The assessment is advisory: no status here blocks publishing or matching (Requirement 8.8), and it is
// keyed by media_id so it is never reused for another image or for post-baling material (Requirement 8.10).
import { ASSESSMENT_DISCLAIMER_TH, stripForbiddenClaims } from '../../domain/assessment.js';
import { type Actor, authorize, serviceRegistry } from '../../domain/permissions.js';
import { type Db, imageAssessments, type ImageAssessment } from '../../repos/index.js';
import { DbMediaStore } from '../media/db-store.js';
import { createMediaService, MediaServiceError, type MediaService, type UploadInput, type UploadResult } from '../media/index.js';
import type { JobQueue } from '../work-queue/index.js';
export { ASSESSMENT_DISCLAIMER_TH } from '../../domain/assessment.js';
export const ASSESS_IMAGE_JOB = 'assess_image';
serviceRegistry.register('assessment', 'LISTING_MANAGE');
export type AssessmentStatus = ImageAssessment['status'];
/** What an assessor reports. The service decides what is stored. */
export type AssessorOutcome =
  | { kind: 'OK'; result: Record<string, unknown>; modelId: string }
  | { kind: 'UNASSESSABLE'; errorCode: string; modelId?: string }
  | { kind: 'UNAVAILABLE'; errorCode: string }
  | { kind: 'RETRYABLE'; errorCode: string };
export interface ImageAssessorPort {
  assess(input: { bytes: Buffer; contentType: 'image/jpeg' | 'image/png' }): Promise<AssessorOutcome>;
}
export type AssessRunResult = { done: true; status: AssessmentStatus } | { done: false; retryCode: string } | { done: true; status: 'MISSING' };
export interface AssessmentPayload {
  media_id: string;
  /** PENDING until the worker has stored a result. */
  status: AssessmentStatus | 'PENDING';
  result: Record<string, unknown> | null;
  model_id: string | null;
  assessed_at: string | null;
  disclaimer_th: typeof ASSESSMENT_DISCLAIMER_TH;
}
export interface AssessmentServiceDeps {
  pool: Db;
  queue: JobQueue;
  secret: string;
  ttlSeconds: number;
  now?: () => Date;
  onEnqueueError?: (err: unknown) => void;
}
const hasContent = (r: Record<string, unknown>): boolean =>
  (typeof r.color === 'string' && r.color !== '') ||
  (typeof r.surface_condition === 'string' && r.surface_condition !== '') ||
  (typeof r.likely_material === 'string' && r.likely_material !== 'UNKNOWN') ||
  (Array.isArray(r.visible_contaminants) && r.visible_contaminants.length > 0);
export function toPayload(mediaId: string, row: ImageAssessment | null): AssessmentPayload {
  return {
    media_id: mediaId,
    status: row?.status ?? 'PENDING',
    result: (row?.result as Record<string, unknown> | null | undefined) ?? null,
    model_id: row?.model_id ?? null,
    assessed_at: row ? row.assessed_at.toISOString() : null,
    disclaimer_th: ASSESSMENT_DISCLAIMER_TH,
  };
}
export function createAssessmentService(deps: AssessmentServiceDeps) {
  const store = new DbMediaStore(deps.pool);
  const media: MediaService = createMediaService({
    pool: deps.pool, secret: deps.secret, ttlSeconds: deps.ttlSeconds, store, ...(deps.now ? { now: deps.now } : {}),
  });
  async function save(
    mediaId: string,
    status: AssessmentStatus,
    fields: { result?: Record<string, unknown> | null; modelId?: string | null; errorCode?: string | null },
  ) {
    await imageAssessments.upsert(deps.pool, {
      media_id: mediaId, status, result: fields.result ?? null, model_id: fields.modelId ?? null, error_code: fields.errorCode ?? null,
    });
  }
  return {
    media,
    /** Upload (owner, size, magic-byte checks), then queue one assessment per media id. The upload never waits for it. */
    async upload(actor: Actor, input: UploadInput): Promise<UploadResult> {
      const r = await media.upload(actor, input);
      try {
        await deps.queue.enqueue({ kind: ASSESS_IMAGE_JOB, payload: { media_id: r.mediaId }, dedupe_key: r.mediaId });
      } catch (err) {
        // The image is stored and the listing can publish; only the optional assessment is lost.
        deps.onEnqueueError?.(err);
      }
      return r;
    },
    /** Owner-only read. Every payload carries the fixed disclaimer. */
    async get(actor: Actor, mediaId: string): Promise<AssessmentPayload> {
      const meta = await store.metadata(mediaId);
      const d = authorize(actor, 'LISTING_MANAGE', meta ? { orgId: meta.orgId } : undefined);
      if (!d.allowed) throw new MediaServiceError(d.code);
      if (!meta) throw new MediaServiceError('NOT_FOUND');
      return toPayload(mediaId, await imageAssessments.getByMedia(deps.pool, mediaId));
    },
    /**
     * Worker entry point (system operation, no actor). Stores exactly one row for the media id.
     * A transient failure asks for a retry until `attempt >= maxAttempts`, then stores FAILED.
     */
    async runAssessment(
      mediaId: string,
      assessor: ImageAssessorPort,
      run: { attempt: number; maxAttempts: number },
    ): Promise<AssessRunResult> {
      const content = await store.get(mediaId);
      if (!content) return { done: true, status: 'MISSING' }; // image deleted before the job ran
      const outcome = await assessor.assess({ bytes: content.bytes, contentType: content.contentType });
      switch (outcome.kind) {
        case 'OK': {
          // Last gate before storage: nothing that claims a moisture %, heating value, grade or standard is kept.
          const { value, removed } = stripForbiddenClaims(outcome.result);
          if (removed > 0 && !hasContent(value)) {
            await save(mediaId, 'UNASSESSABLE', { modelId: outcome.modelId, errorCode: 'CLAIMS_REJECTED' });
            return { done: true, status: 'UNASSESSABLE' };
          }
          await save(mediaId, 'OK', { result: value, modelId: outcome.modelId });
          return { done: true, status: 'OK' };
        }
        case 'UNASSESSABLE':
          await save(mediaId, 'UNASSESSABLE', { modelId: outcome.modelId ?? null, errorCode: outcome.errorCode });
          return { done: true, status: 'UNASSESSABLE' };
        case 'UNAVAILABLE':
          await save(mediaId, 'UNAVAILABLE', { errorCode: outcome.errorCode });
          return { done: true, status: 'UNAVAILABLE' };
        case 'RETRYABLE':
          if (run.attempt < run.maxAttempts) return { done: false, retryCode: outcome.errorCode };
          await save(mediaId, 'FAILED', { errorCode: outcome.errorCode });
          return { done: true, status: 'FAILED' };
      }
    },
  };
}
export type AssessmentService = ReturnType<typeof createAssessmentService>;
