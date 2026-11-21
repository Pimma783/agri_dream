import { z } from 'zod';
import { ASSESS_IMAGE_JOB, type AssessmentService, type ImageAssessorPort } from '../services/index.js';
import type { HandlerRegistry } from './registry.js';
import { PermanentJobError, RetryableJobError } from './types.js';
const Payload = z.object({ media_id: z.string().uuid() });
/** Registers the `assess_image` handler. The job core is untouched; this is the only coupling. */
export function registerAssessImage(
  handlers: HandlerRegistry,
  deps: { assessment: Pick<AssessmentService, 'runAssessment'>; assessor: ImageAssessorPort },
): HandlerRegistry {
  return handlers.register(ASSESS_IMAGE_JOB, async (job) => {
    const p = Payload.safeParse(job.payload);
    if (!p.success) throw new PermanentJobError('BAD_PAYLOAD');
    const r = await deps.assessment.runAssessment(p.data.media_id, deps.assessor, {
      attempt: job.attempts,
      maxAttempts: job.max_attempts,
    });
    if (!r.done) throw new RetryableJobError(r.retryCode);
  });
}
