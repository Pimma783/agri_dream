import type { ParsedLineEvent } from '../event.js';
import type { AnyQuickReplyItem, TextMessage } from '../messages.js';

export type HandlerChannel = 'farmer' | 'baler' | 'factory';

/** What a per-role handler gets. `reply` already knows the channel, the LINE user and the reply token. */
export interface LineEventContext {
  readonly channel: HandlerChannel;
  readonly webhookEventId: string;
  readonly event: ParsedLineEvent;
  /** Sends on this event's own channel only: reply token when fresh, otherwise an outbox push. */
  reply(messages: readonly TextMessage<AnyQuickReplyItem>[]): Promise<void>;
}

export type LineChannelHandler = (ctx: LineEventContext) => Promise<void>;

