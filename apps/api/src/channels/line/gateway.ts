// LINE gateway (design.md "LINE gateway"). The worker's line_event job calls `process` with a stored webhook event id.
// It parses the event, picks the handler for the event's own channel, and gives the handler a `reply` that can only
// answer that channel's LINE user: the reply token while it is fresh, otherwise a deduplicated outbox push.
import type { LineClient } from '../../adapters/line/index.js';
import type { LineEventStore } from '../../services/index.js';
import { parseLineEvent } from './event.js';
import type { LineChannelHandler, HandlerChannel } from './handlers/types.js';
import type { AnyQuickReplyItem, TextMessage } from './messages.js';

/** Reply tokens are short-lived and single-use. After this age the gateway pushes through the outbox instead. */
export const REPLY_TOKEN_MAX_AGE_MS = 25_000;
const MAX_MESSAGES = 5;

export interface LineGatewayDeps {
  events: LineEventStore;
  line: LineClient;
  handlers: Record<HandlerChannel, LineChannelHandler>;
  now?: () => Date;
  log?: (obj: object, msg: string) => void;
}

export type GatewayOutcome = 'handled' | 'ignored' | 'event_not_found';

type Replyable = { reply?: (input: { replyToken: string; messages: ReadonlyArray<Record<string, unknown>> }) => Promise<{ ok: boolean }> };

export function createLineGateway(deps: LineGatewayDeps) {
  const now = deps.now ?? (() => new Date());
  return {
    async process(webhookEventId: string): Promise<GatewayOutcome> {
      const stored = await deps.events.get(webhookEventId);
      if (!stored) return 'event_not_found';
      const event = parseLineEvent(stored.payload);
      if (event.kind === 'ignored') return 'ignored';
      const channel = stored.channel;
      let sent = 0;
      const reply = async (messages: readonly TextMessage<AnyQuickReplyItem>[]): Promise<void> => {
        if (messages.length === 0) return;
        const wire = messages.slice(0, MAX_MESSAGES).map((m) => ({ ...m }));
        const token = event.replyToken;
        const fresh = event.timestamp === undefined || now().getTime() - event.timestamp <= REPLY_TOKEN_MAX_AGE_MS;
        if (token && fresh) {
          // Only the real client has reply(); the fake and any push-only client fall through to the outbox.
          const client = deps.line.forChannel(channel) as Replyable;
          if (client.reply) {
            const r = await client.reply({ replyToken: token, messages: wire });
            if (r.ok) return;
            deps.log?.({ channel }, 'line reply failed, queueing push');
          }
        }
        const queued = await deps.events.enqueuePush({
          channel, lineUserId: event.lineUserId, messages: wire, dedupeKey: `line_event:${webhookEventId}:${sent++}`, relatedId: webhookEventId,
        });
        if (!queued) deps.log?.({ channel }, 'line push not queued');
      };
      await deps.handlers[channel]({ channel, webhookEventId, event, reply });
      return 'handled';
    },
  };
}
export type LineGateway = ReturnType<typeof createLineGateway>;
