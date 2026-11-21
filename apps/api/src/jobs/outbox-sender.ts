import { RETRYABLE_LINE_CODES, type LineClient } from '../adapters/line/index.js';
import type { OutboxQueue } from '../services/index.js';
import { type BackoffPolicy, DEFAULT_BACKOFF, backoffDelayMs } from './backoff.js';
import { type JobsClock, type JobsLogger, silentLogger, systemClock } from './types.js';

export interface OutboxSenderOptions {
  queue: OutboxQueue;
  line: LineClient;
  clock?: JobsClock;
  logger?: JobsLogger;
  leaseMs?: number;
  batchSize?: number;
  backoff?: BackoffPolicy;
}

export interface OutboxTickResult {
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
}

const asMessages = (message: unknown): Array<Record<string, unknown>> | null => {
  const list = Array.isArray(message) ? message : [message];
  if (list.length === 0 || list.length > 5) return null;
  return list.every((m) => typeof m === 'object' && m !== null && !Array.isArray(m)) ? (list as Array<Record<string, unknown>>) : null;
};

/**
 * Sends claimed outbox rows through LineClient.forChannel(row.channel), so the token always matches the row's channel.
 * The retry key stored on the row is reused on every attempt, so a retry after an unknown outcome does not deliver twice.
 * It touches only notification_outbox: a failed send never changes an offer or an agreement (Requirement 15.3, 15.4).
 */
export class OutboxSender {
  private readonly queue: OutboxQueue;
  private readonly line: LineClient;
  private readonly clock: JobsClock;
  private readonly logger: JobsLogger;
  private readonly leaseMs: number;
  private readonly batchSize: number;
  private readonly backoff: BackoffPolicy;

  constructor(o: OutboxSenderOptions) {
    this.queue = o.queue;
    this.line = o.line;
    this.clock = o.clock ?? systemClock;
    this.logger = o.logger ?? silentLogger;
    this.leaseMs = o.leaseMs ?? 60_000;
    this.batchSize = o.batchSize ?? 10;
    this.backoff = o.backoff ?? DEFAULT_BACKOFF;
  }

  async tick(): Promise<OutboxTickResult> {
    const result: OutboxTickResult = { claimed: 0, sent: 0, retried: 0, dead: 0 };
    result.dead += await this.queue.reapExhausted(this.clock.now());
    const claimed = await this.queue.claim(this.clock.now(), this.leaseMs, this.batchSize);
    result.claimed = claimed.length;
    for (const { row, lineUserId } of claimed) {
      const dead = async (code: string) => {
        await this.queue.markDead(row.id, code);
        this.logger.error({ outboxId: row.id, channel: row.channel, code }, 'outbox message dead');
        result.dead++;
      };
      const messages = asMessages(row.message);
      if (lineUserId === null) { await dead('RECIPIENT_MISSING'); continue; }
      if (!messages) { await dead('INVALID_MESSAGE'); continue; }
      let outcome;
      try {
        outcome = await this.line.forChannel(row.channel).push({ to: lineUserId, messages, retryKey: row.retry_key });
      } catch {
        outcome = { ok: false, code: 'NETWORK' } as const;
      }
      if (outcome.ok) {
        await this.queue.markSent(row.id, this.clock.now());
        result.sent++;
        continue;
      }
      if (!RETRYABLE_LINE_CODES.has(outcome.code) || row.attempts >= row.max_attempts) {
        await dead(outcome.code);
        continue;
      }
      const wait = Math.max(backoffDelayMs(row.attempts, this.backoff, () => this.clock.random()), outcome.retryAfterMs ?? 0);
      await this.queue.retryLater(row.id, new Date(this.clock.now().getTime() + wait), outcome.code);
      this.logger.warn({ outboxId: row.id, channel: row.channel, code: outcome.code, attempts: row.attempts, waitMs: wait }, 'outbox send will retry');
      result.retried++;
    }
    return result;
  }
}
