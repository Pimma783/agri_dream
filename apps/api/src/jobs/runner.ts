import type { JobQueue } from '../services/index.js';
import { type BackoffPolicy, DEFAULT_BACKOFF, backoffDelayMs } from './backoff.js';
import type { HandlerRegistry } from './registry.js';
import { type JobsClock, type JobsLogger, PermanentJobError, RetryableJobError, errorCodeOf, silentLogger, systemClock } from './types.js';

export interface JobRunnerOptions {
  queue: JobQueue;
  handlers: HandlerRegistry;
  clock?: JobsClock;
  logger?: JobsLogger;
  leaseMs?: number;
  batchSize?: number;
  backoff?: BackoffPolicy;
}

export interface JobTickResult {
  claimed: number;
  done: number;
  retried: number;
  dead: number;
}

/** Claims due jobs and runs their handlers. Safe to run in several worker processes: claiming uses SKIP LOCKED. */
export class JobRunner {
  private readonly queue: JobQueue;
  private readonly handlers: HandlerRegistry;
  private readonly clock: JobsClock;
  private readonly logger: JobsLogger;
  private readonly leaseMs: number;
  private readonly batchSize: number;
  private readonly backoff: BackoffPolicy;

  constructor(o: JobRunnerOptions) {
    this.queue = o.queue;
    this.handlers = o.handlers;
    this.clock = o.clock ?? systemClock;
    this.logger = o.logger ?? silentLogger;
    this.leaseMs = o.leaseMs ?? 60_000;
    this.batchSize = o.batchSize ?? 10;
    this.backoff = o.backoff ?? DEFAULT_BACKOFF;
  }

  async tick(): Promise<JobTickResult> {
    const result: JobTickResult = { claimed: 0, done: 0, retried: 0, dead: 0 };
    result.dead += await this.queue.reapExhausted(this.clock.now());
    const jobs = await this.queue.claim(this.clock.now(), this.leaseMs, this.batchSize);
    result.claimed = jobs.length;
    for (const job of jobs) {
      const handler = this.handlers.get(job.kind);
      if (!handler) {
        await this.queue.markDead(job.id, 'NO_HANDLER');
        this.logger.error({ jobId: job.id, kind: job.kind }, 'no handler for job kind');
        result.dead++;
        continue;
      }
      try {
        await handler(job, { attempt: job.attempts, now: this.clock.now() });
        await this.queue.complete(job.id);
        result.done++;
      } catch (err) {
        const code = errorCodeOf(err);
        const permanent = err instanceof PermanentJobError || job.attempts >= job.max_attempts;
        if (permanent) {
          await this.queue.markDead(job.id, code);
          this.logger.error({ jobId: job.id, kind: job.kind, code, attempts: job.attempts }, 'job dead');
          result.dead++;
        } else {
          const wait = Math.max(
            backoffDelayMs(job.attempts, this.backoff, () => this.clock.random()),
            err instanceof RetryableJobError ? (err.retryAfterMs ?? 0) : 0,
          );
          await this.queue.retryLater(job.id, new Date(this.clock.now().getTime() + wait), code);
          this.logger.warn({ jobId: job.id, kind: job.kind, code, attempts: job.attempts, waitMs: wait }, 'job will retry');
          result.retried++;
        }
      }
    }
    return result;
  }
}
