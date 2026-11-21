// Webhook intake: store each LINE event once and queue one job for it, in one transaction.
import type pg from 'pg';
import { jobs, lineIdentities, outbox, webhookEvents, withTransaction } from '../../repos/index.js';
export type WebhookChannel = 'farmer' | 'baler' | 'factory';
export interface IncomingLineEvent {
  webhookEventId: string;
  [k: string]: unknown;
}
export interface IngestResult {
  received: number;
  created: number;
}
export interface WebhookService {
  ingest(channel: WebhookChannel, events: readonly IncomingLineEvent[]): Promise<IngestResult>;
}
export function createWebhookService(deps: { pool: pg.Pool }): WebhookService {
  return {
    async ingest(channel, events) {
      if (events.length === 0) return { received: 0, created: 0 };
      return withTransaction(deps.pool, async (tx) => {
        let created = 0;
        for (const event of events) {
          const stored = await webhookEvents.insertIfNew(tx, channel, event.webhookEventId, event);
          if (!stored) continue; // duplicate delivery: no second job
          await jobs.enqueue(tx, {
            kind: 'line_event',
            payload: { channel, event_id: event.webhookEventId, webhook_event_id: stored.id },
            dedupe_key: `${channel}:${event.webhookEventId}`,
          });
          created++;
        }
        return { received: events.length, created };
      });
    },
  };
}

export interface StoredLineEvent {
  id: string;
  channel: WebhookChannel;
  eventId: string;
  payload: unknown;
}

export interface LineEventStore {
  /** The stored webhook event, or null when the id is unknown. */
  get(id: string): Promise<StoredLineEvent | null>;
  /**
   * Queue a push to a LINE user on one channel, once per `dedupeKey`. Returns false when the key was already queued or
   * the LINE user is unknown. The recipient is looked up on that same channel, so a message never crosses roles.
   */
  enqueuePush(input: { channel: WebhookChannel; lineUserId: string; messages: readonly object[]; dedupeKey: string; relatedId?: string }): Promise<boolean>;
}

/** System access to webhook_events and the outbox for the LINE gateway (jobs and channels may not import repos). */
export function createLineEventStore(deps: { pool: pg.Pool }): LineEventStore {
  return {
    async get(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const row = await webhookEvents.get(deps.pool, id);
      return row ? { id: row.id, channel: row.channel, eventId: row.event_id, payload: row.payload } : null;
    },
    async enqueuePush({ channel, lineUserId, messages, dedupeKey, relatedId }) {
      const identity = await lineIdentities.getByChannelUser(deps.pool, channel, lineUserId);
      if (!identity) return false;
      const row = await outbox.enqueue(deps.pool, {
        channel, to_line_identity_id: identity.id, message: messages, dedupe_key: dedupeKey,
        ...(relatedId ? { related_type: 'webhook_event', related_id: relatedId } : {}),
      });
      return row !== null;
    },
  };
}
