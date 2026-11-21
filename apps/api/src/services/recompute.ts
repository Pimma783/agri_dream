// Enqueue of the `recompute_matches` job (Requirement 7.7). The job itself is task 7.1.
// The row is written inside the caller's transaction, so a rolled-back change leaves no job behind.
import { type Db, jobs } from '../repos/index.js';

export const RECOMPUTE_MATCHES_JOB = 'recompute_matches';
export type MatchEntityType = 'LISTING' | 'DEMAND' | 'BALING_SERVICE' | 'BALING_REQUEST';

export interface RecomputePayload {
  entity_type: MatchEntityType;
  entity_id: string;
  /** Entity version that triggered the recompute. */
  version: number;
}

/** One job per (entity, version): a repeated enqueue for the same version is a no-op. */
export async function enqueueRecompute(db: Db, p: RecomputePayload): Promise<void> {
  await jobs.enqueue(db, {
    kind: RECOMPUTE_MATCHES_JOB,
    payload: p,
    dedupe_key: `${RECOMPUTE_MATCHES_JOB}:${p.entity_type}:${p.entity_id}:${p.version}`,
  });
}
