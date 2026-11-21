import { RECOMPUTE_MATCHES_JOB, type MatchingService } from '../services/index.js';
import type { HandlerRegistry } from './registry.js';
import { PermanentJobError, RetryableJobError } from './types.js';

/** Registers the `recompute_matches` handler. The job core is untouched; this is the only coupling. */
export function registerRecomputeMatches(handlers: HandlerRegistry, deps: { matching: Pick<MatchingService, 'recompute'> }): HandlerRegistry {
  return handlers.register(RECOMPUTE_MATCHES_JOB, async (job) => {
    const r = await deps.matching.recompute(job.payload);
    if (r.ok) return;
    if (r.error.code === 'VALIDATION') throw new PermanentJobError('BAD_PAYLOAD');
    throw new RetryableJobError(r.error.code);
  });
}
