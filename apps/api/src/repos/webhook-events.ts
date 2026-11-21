import { z } from 'zod';
import { type Db, maybe, ts, uuid } from './db.js';
import { lineChannel } from './enums.js';
import { table } from './table.js';
export const WebhookEventRow = z.object({
  id: uuid,
  channel: lineChannel,
  event_id: z.string(),
  payload: z.unknown(),
  received_at: ts,
});
export type WebhookEvent = z.infer<typeof WebhookEventRow>;
const t = table('webhook_events', WebhookEventRow, { json: ['payload'] });
export const webhookEvents = {
  /** Store an event once per (channel, event_id). Returns null for a duplicate delivery. */
  insertIfNew: (db: Db, channel: WebhookEvent['channel'], eventId: string, payload: unknown) =>
    t.insertIfAbsent(db, { channel, event_id: eventId, payload }, 'channel, event_id'),
  get: t.get,
  getByEvent: (db: Db, channel: WebhookEvent['channel'], eventId: string) =>
    maybe(db, WebhookEventRow, 'SELECT * FROM webhook_events WHERE channel = $1 AND event_id = $2', [channel, eventId]),
};
