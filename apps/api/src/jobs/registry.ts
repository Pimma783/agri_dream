import type { JobRecord } from '../services/index.js';

export interface JobContext {
  /** Attempt number for this run, starting at 1. */
  attempt: number;
  now: Date;
}
export type JobHandler = (job: JobRecord, ctx: JobContext) => Promise<void>;

/** Maps job.kind to a handler. Later tasks register `line_event` and others. */
export class HandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();
  register(kind: string, handler: JobHandler): this {
    if (this.handlers.has(kind)) throw new Error(`job handler already registered: ${kind}`);
    this.handlers.set(kind, handler);
    return this;
  }
  get(kind: string): JobHandler | undefined {
    return this.handlers.get(kind);
  }
  kinds(): string[] {
    return [...this.handlers.keys()];
  }
}
