// Layer: jobs (see design.md "Module boundaries"). Enforced by eslint.config.mjs.
export { backoffDelayMs, DEFAULT_BACKOFF } from './backoff.js';
export type { BackoffPolicy } from './backoff.js';
export { HandlerRegistry } from './registry.js';
export type { JobContext, JobHandler } from './registry.js';
export { JobRunner } from './runner.js';
export type { JobRunnerOptions, JobTickResult } from './runner.js';
export { OutboxSender } from './outbox-sender.js';
export type { OutboxSenderOptions, OutboxTickResult } from './outbox-sender.js';
export { SweeperSchedule } from './sweepers.js';
export type { Sweeper } from './sweepers.js';
export { createWorkerLoop } from './worker-loop.js';
export type { WorkerLoop } from './worker-loop.js';
export { PermanentJobError, RetryableJobError, systemClock } from './types.js';
export type { JobsClock, JobsLogger } from './types.js';
export { registerAssessImage } from './assess-image.js';
export { registerRecomputeMatches } from './recompute-matches.js';
export { createExpireOffersSweeper } from './expire-offers.js';
export { registerLineEvent, LINE_EVENT_JOB } from './line-event.js';
