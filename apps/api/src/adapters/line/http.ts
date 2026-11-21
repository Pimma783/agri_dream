import type {
  LineChannelClient, LineChannelKey, LineClient, LineContentResult, LinePushInput, LineSendErrorCode, LineSendResult,
} from './port.js';
export type { LineContentResult } from './port.js';

export const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
export const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
export const LINE_CONTENT_URL = (messageId: string): string =>
  `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`;

export const DEFAULT_LINE_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_CONTENT_BYTES = 10 * 1024 * 1024;
const MAX_MESSAGES = 5;

/** Channel client with the extra calls that only the real LINE API serves. The port itself stays push-only. */
export interface HttpLineChannelClient extends LineChannelClient {
  /** Reply to a webhook event with its reply token. Replies carry no retry key. */
  reply(input: { replyToken: string; messages: ReadonlyArray<Record<string, unknown>> }): Promise<LineSendResult>;
  /** Download the bytes of an image message. Fails with TOO_LARGE past the size cap. */
  getContent(messageId: string): Promise<LineContentResult>;
}

export interface HttpLineClientOptions {
  /** Per-channel access tokens. A channel without a token answers UNAUTHORIZED and sends nothing. */
  tokens: Partial<Record<LineChannelKey, string>>;
  /** Injected in tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxContentBytes?: number;
}

/**
 * Real LINE Messaging API client (kind 'real'). Each channel client holds only its own access token.
 * Tokens, recipient ids and message text are never logged, and error results carry codes only.
 */
export class HttpLineClient implements LineClient {
  readonly kind = 'real' as const;
  private readonly tokens: Partial<Record<LineChannelKey, string>>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxContentBytes: number;

  constructor(options: HttpLineClientOptions) {
    this.tokens = { ...options.tokens };
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LINE_TIMEOUT_MS;
    this.maxContentBytes = options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  }

  forChannel(channel: LineChannelKey): HttpLineChannelClient {
    return {
      channel,
      push: (input) => this.push(channel, input),
      reply: (input) => this.reply(channel, input),
      getContent: (messageId) => this.getContent(channel, messageId),
    };
  }

  private push(channel: LineChannelKey, input: LinePushInput): Promise<LineSendResult> {
    if (input.messages.length === 0 || input.messages.length > MAX_MESSAGES) return Promise.resolve(invalid());
    return this.post(channel, LINE_PUSH_URL, { to: input.to, messages: input.messages }, { 'X-Line-Retry-Key': input.retryKey });
  }

  private reply(
    channel: LineChannelKey,
    input: { replyToken: string; messages: ReadonlyArray<Record<string, unknown>> },
  ): Promise<LineSendResult> {
    if (input.messages.length === 0 || input.messages.length > MAX_MESSAGES) return Promise.resolve(invalid());
    return this.post(channel, LINE_REPLY_URL, { replyToken: input.replyToken, messages: input.messages }, {});
  }

  private async post(
    channel: LineChannelKey,
    url: string,
    body: unknown,
    extraHeaders: Record<string, string>,
  ): Promise<LineSendResult> {
    const token = this.tokens[channel];
    if (!token) return { ok: false, code: 'UNAUTHORIZED' };
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extraHeaders },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      return { ok: false, code: transportCode(e) };
    }
    await discard(res);
    if (res.ok) return { ok: true, duplicate: false };
    // LINE answers 409 when the retry key was already accepted: the first request was delivered.
    if (res.status === 409 && 'X-Line-Retry-Key' in extraHeaders) return { ok: true, duplicate: true };
    return failure(res);
  }

  private async getContent(channel: LineChannelKey, messageId: string): Promise<LineContentResult> {
    const token = this.tokens[channel];
    if (!token) return { ok: false, code: 'UNAUTHORIZED' };
    let res: Response;
    try {
      res = await this.fetchImpl(LINE_CONTENT_URL(messageId), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      return { ok: false, code: transportCode(e) };
    }
    if (!res.ok) {
      await discard(res);
      return failure(res);
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxContentBytes) {
      await discard(res);
      return { ok: false, code: 'TOO_LARGE' };
    }
    try {
      const bytes = await readCapped(res, this.maxContentBytes);
      if (!bytes) return { ok: false, code: 'TOO_LARGE' };
      return { ok: true, bytes, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
    } catch (e) {
      return { ok: false, code: transportCode(e) };
    }
  }
}

function invalid(): LineSendResult {
  return { ok: false, code: 'INVALID_REQUEST' };
}

function transportCode(e: unknown): LineSendErrorCode {
  const name = e instanceof Error ? e.name : '';
  return name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
}

function failure(res: Response): { ok: false; code: LineSendErrorCode; retryAfterMs?: number } {
  const s = res.status;
  if (s === 429) {
    const secs = Number(res.headers.get('retry-after'));
    return Number.isFinite(secs) && secs >= 0 && res.headers.get('retry-after')?.trim()
      ? { ok: false, code: 'RATE_LIMITED', retryAfterMs: Math.round(secs * 1000) }
      : { ok: false, code: 'RATE_LIMITED' };
  }
  if (s >= 500) return { ok: false, code: 'UPSTREAM_5XX' };
  if (s === 401 || s === 403) return { ok: false, code: 'UNAUTHORIZED' };
  return { ok: false, code: 'INVALID_REQUEST' };
}

async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // ignore: the body is not needed
  }
}

/** Reads the body, returning null as soon as it exceeds `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
