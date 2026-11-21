export interface JobsLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}
export const silentLogger: JobsLogger = { info() {}, warn() {}, error() {} };

export interface JobsClock {
  now(): Date;
  /** [0, 1) */
  random(): number;
}
export const systemClock: JobsClock = { now: () => new Date(), random: () => Math.random() };

/** Error codes are stored in last_error_code, so they must not carry user data. */
export function errorCodeOf(err: unknown): string {
  if (err instanceof PermanentJobError) return err.code;
  if (err instanceof RetryableJobError) return err.code;
  return 'HANDLER_ERROR';
}

/** Throw from a handler when retrying cannot help: the job goes straight to DEAD. */
export class PermanentJobError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'PermanentJobError';
  }
}
/** Throw from a handler to retry; `retryAfterMs` overrides the backoff when it is longer. */
export class RetryableJobError extends Error {
  constructor(readonly code: string, readonly retryAfterMs?: number, message?: string) {
    super(message ?? code);
    this.name = 'RetryableJobError';
  }
}
