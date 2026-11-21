// LINE port (design.md "LINE gateway"). No HTTP here: the real client is task 9.9.
import type { AdapterKind } from '../kinds.js';
export type { AdapterKind };

export type LineChannelKey = 'farmer' | 'baler' | 'factory';
export const LINE_CHANNEL_KEYS: readonly LineChannelKey[] = ['farmer', 'baler', 'factory'];

/** One push to one LINE user. `retryKey` is sent as X-Line-Retry-Key and is stable across retries. */
export interface LinePushInput {
  /** LINE user id of the recipient (not our identity id). */
  to: string;
  /** LINE message objects. LINE accepts at most 5 per request. */
  messages: ReadonlyArray<Record<string, unknown>>;
  retryKey: string;
}

export type LineSendErrorCode =
  | 'RATE_LIMITED' // HTTP 429; may carry retryAfterMs
  | 'UPSTREAM_5XX'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'UNAUTHORIZED' // bad or expired channel token: retrying will not help until the token is fixed
  | 'INVALID_REQUEST' // 400: permanent
  | 'RECIPIENT_UNREACHABLE'; // blocked, unfollowed or unknown user: permanent

export const RETRYABLE_LINE_CODES: ReadonlySet<LineSendErrorCode> = new Set<LineSendErrorCode>([
  'RATE_LIMITED', 'UPSTREAM_5XX', 'TIMEOUT', 'NETWORK',
]);

export type LineSendResult =
  /** `duplicate` is true when LINE reported that this retry key was already accepted (HTTP 409). It counts as delivered. */
  | { ok: true; duplicate: boolean }
  | { ok: false; code: LineSendErrorCode; retryAfterMs?: number };

/** Result of downloading a message's content (image bytes) through a channel's own token. */
export type LineContentResult =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; code: LineSendErrorCode | 'TOO_LARGE'; retryAfterMs?: number };

/** A client bound to one channel. It owns that channel's access token; callers cannot pass a token. */
export interface LineChannelClient {
  readonly channel: LineChannelKey;
  push(input: LinePushInput): Promise<LineSendResult>;
  /** Download an image message with this channel's token. Real and fake clients provide it. */
  getContent?(messageId: string): Promise<LineContentResult>;
}

export interface LineClient {
  readonly kind: AdapterKind;
  forChannel(channel: LineChannelKey): LineChannelClient;
}
