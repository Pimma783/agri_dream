// Thin service-layer access to the jobs and notification_outbox tables for the worker (jobs/ may not import repos).
// These are system operations: no actor, no authorization, and no business rules. The sender and runner
// can only reach these tables, never offers or agreements.
import {
  type Db, type Job, type OutboxMessage, jobs, lineIdentities, outbox,
} from '../../repos/index.js';

export type JobRecord = Job;
export type OutboxRecord = OutboxMessage;
export type NewJob = { kind: string; payload: unknown; dedupe_key?: string; run_at?: Date; max_attempts?: number };

export interface JobQueue {
  enqueue(job: NewJob): Promise<JobRecord | null>;
  /** Claim due jobs (SKIP LOCKED, lease). Each claim counts one attempt. */
  claim(now: Date, leaseMs: number, limit: number): Promise<JobRecord[]>;
  complete(id: string): Promise<boolean>;
  retryLater(id: string, runAt: Date, errorCode: string): Promise<boolean>;
  markDead(id: string, errorCode: string): Promise<boolean>;
  /** Park RUNNING jobs that ran out of attempts and whose lease expired. */
  reapExhausted(now: Date): Promise<number>;
}

export function createJobQueue(db: Db): JobQueue {
  return {
    enqueue: (job) => jobs.enqueue(db, job),
    claim: (now, leaseMs, limit) => jobs.claim(db, now, leaseMs, limit),
    complete: async (id) => (await jobs.complete(db, id)) !== null,
    retryLater: async (id, runAt, code) => (await jobs.retryLater(db, id, runAt, code)) !== null,
    markDead: async (id, code) => (await jobs.markDead(db, id, code)) !== null,
    reapExhausted: async (now) => (await jobs.deadExhausted(db, now)).length,
  };
}

/** A claimed outbox row plus the recipient's LINE user id, resolved from line_identities. */
export interface ClaimedOutbox {
  row: OutboxRecord;
  /** null when the identity row cannot be found; the sender treats that as a permanent failure. */
  lineUserId: string | null;
}

export interface OutboxQueue {
  claim(now: Date, leaseMs: number, limit: number): Promise<ClaimedOutbox[]>;
  markSent(id: string, at: Date): Promise<boolean>;
  retryLater(id: string, at: Date, errorCode: string): Promise<boolean>;
  markDead(id: string, errorCode: string): Promise<boolean>;
  reapExhausted(now: Date): Promise<number>;
}

export function createOutboxQueue(db: Db): OutboxQueue {
  return {
    async claim(now, leaseMs, limit) {
      const rows = await outbox.claim(db, now, leaseMs, limit);
      return Promise.all(
        rows.map(async (row) => ({ row, lineUserId: (await lineIdentities.get(db, row.to_line_identity_id))?.line_user_id ?? null })),
      );
    },
    markSent: async (id, at) => (await outbox.markSent(db, id, at)) !== null,
    retryLater: async (id, at, code) => (await outbox.retryLater(db, id, at, code)) !== null,
    markDead: async (id, code) => (await outbox.markDead(db, id, code)) !== null,
    reapExhausted: async (now) => (await outbox.deadExhausted(db, now)).length,
  };
}
