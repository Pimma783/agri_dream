import type { LineChannelClient, LineChannelKey, LineClient, LineContentResult, LinePushInput, LineSendResult } from './port.js';

/** What the fake saw. `token` is the synthetic token the channel client owns, so tests can check channel routing. */
export interface RecordedPush {
  channel: LineChannelKey;
  token: string;
  to: string;
  messages: ReadonlyArray<Record<string, unknown>>;
  retryKey: string;
  /** False when the call failed (scripted failure). */
  accepted: boolean;
}

/**
 * In-memory LineClient for tests and dev (kind 'mock'). It never touches the network.
 * Like LINE, it accepts a retry key once per channel and answers later pushes with the same key as a duplicate.
 * `failNext` scripts results for upcoming calls, in order.
 */
export class FakeLineClient implements LineClient {
  readonly kind = 'mock' as const;
  readonly pushes: RecordedPush[] = [];
  private readonly accepted = new Set<string>();
  private readonly script: LineSendResult[] = [];
  private readonly tokens: Record<LineChannelKey, string>;

  constructor(tokens: Partial<Record<LineChannelKey, string>> = {}) {
    this.tokens = {
      farmer: tokens.farmer ?? 'fake-token-farmer',
      baler: tokens.baler ?? 'fake-token-baler',
      factory: tokens.factory ?? 'fake-token-factory',
    };
  }

  /** The next calls return these results in order, then the fake goes back to accepting. */
  failNext(...results: LineSendResult[]): void {
    this.script.push(...results);
  }

  /** Pushes that LINE would have delivered (accepted, not counting duplicates). */
  get delivered(): RecordedPush[] {
    return this.pushes.filter((p) => p.accepted);
  }

  /** Scripted image content by message id, per channel. Tests fill it; there is no network. */
  readonly contents = new Map<string, LineContentResult>();
  /** Every content download the fake saw, so tests can check which channel (token) fetched it. */
  readonly contentCalls: Array<{ channel: LineChannelKey; token: string; messageId: string }> = [];

  setContent(messageId: string, result: LineContentResult): void {
    this.contents.set(messageId, result);
  }

  forChannel(channel: LineChannelKey): LineChannelClient {
    return {
      channel,
      push: (input) => this.push(channel, input),
      getContent: async (messageId) => {
        this.contentCalls.push({ channel, token: this.tokens[channel], messageId });
        return this.contents.get(messageId) ?? { ok: false, code: 'INVALID_REQUEST' };
      },
    };
  }

  private async push(channel: LineChannelKey, input: LinePushInput): Promise<LineSendResult> {
    const record = (accepted: boolean) =>
      this.pushes.push({ channel, token: this.tokens[channel], to: input.to, messages: input.messages, retryKey: input.retryKey, accepted });
    const scripted = this.script.shift();
    if (scripted) {
      if (scripted.ok && !scripted.duplicate) this.accepted.add(`${channel}:${input.retryKey}`);
      record(scripted.ok && !scripted.duplicate);
      return scripted;
    }
    const key = `${channel}:${input.retryKey}`;
    if (this.accepted.has(key)) return { ok: true, duplicate: true };
    this.accepted.add(key);
    record(true);
    return { ok: true, duplicate: false };
  }
}
