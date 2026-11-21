import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { isForbiddenModelId } from '../../config/guards.js';
import {
  RETRYABLE_CODES,
  type BedrockPort,
  type ConverseErrorCode,
  type ConverseRequest,
  type ConverseResult,
} from './port.js';

/** The only SDK surface the adapter uses; tests inject a fake with this shape. */
export interface ConverseClient {
  send(command: ConverseCommand, options: { abortSignal: AbortSignal }): Promise<ConverseCommandOutput>;
}

export interface RealBedrockOptions {
  region: string;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Retries after the first attempt, only for TIMEOUT/THROTTLED/UPSTREAM_5XX. */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injected so unit tests never create a real SDK client. */
  clientFactory?: (region: string) => ConverseClient;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

/** SDK retries are off (maxAttempts=1); the adapter owns the retry loop. Credentials: default provider chain. */
export function defaultClientFactory(region: string): ConverseClient {
  return new BedrockRuntimeClient({ region, maxAttempts: 1 }) as unknown as ConverseClient;
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done(): void {
      signal.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/** Maps an SDK or network error to a port error code. Never includes the error message. */
export function classifyError(err: unknown): ConverseErrorCode {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  const name = e?.name ?? '';
  const status = e?.$metadata?.httpStatusCode;
  if (name === 'AbortError' || name === 'TimeoutError' || name === 'ModelTimeoutException') return 'TIMEOUT';
  if (name === 'ThrottlingException' || name === 'TooManyRequestsException' || status === 429) return 'THROTTLED';
  if (name === 'ServiceQuotaExceededException') return 'THROTTLED';
  if (
    name === 'AccessDeniedException' ||
    name === 'UnrecognizedClientException' ||
    name === 'ExpiredTokenException' ||
    name === 'CredentialsProviderError' ||
    name === 'TokenProviderError' ||
    status === 401 ||
    status === 403
  ) {
    return 'ACCESS_DENIED';
  }
  if (name === 'ResourceNotFoundException' || name === 'ModelNotReadyException' || name === 'ModelErrorException') {
    return 'MODEL_UNSUPPORTED';
  }
  if (name === 'ValidationException' || status === 400) return 'INVALID_REQUEST';
  if (
    name === 'InternalServerException' ||
    name === 'ServiceUnavailableException' ||
    (typeof status === 'number' && status >= 500)
  ) {
    return 'UPSTREAM_5XX';
  }
  return 'UPSTREAM_5XX';
}

export class RealBedrock implements BedrockPort {
  readonly kind = 'real' as const;
  private readonly client: ConverseClient;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;

  constructor(opts: RealBedrockOptions) {
    this.client = (opts.clientFactory ?? defaultClientFactory)(opts.region);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = Math.min(opts.maxRetries ?? 2, 2);
    this.baseDelayMs = opts.baseDelayMs ?? 400;
    this.maxDelayMs = opts.maxDelayMs ?? 4_000;
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
  }

  async converse(req: ConverseRequest, signal: AbortSignal): Promise<ConverseResult> {
    if (isForbiddenModelId(req.modelId)) {
      return { ok: false, code: 'MODEL_UNSUPPORTED', retryable: false };
    }
    if (!Number.isInteger(req.maxTokens) || req.maxTokens <= 0) {
      return { ok: false, code: 'INVALID_REQUEST', retryable: false };
    }
    const input = toInput(req);

    let last: ConverseErrorCode = 'UPSTREAM_5XX';
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal.aborted) return { ok: false, code: 'TIMEOUT', retryable: false };
      const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
      try {
        const out = await this.client.send(new ConverseCommand(input), { abortSignal: attemptSignal });
        return toResult(out, req.modelId);
      } catch (err) {
        last = classifyError(err);
      }
      if (!RETRYABLE_CODES.has(last) || attempt === this.maxRetries || signal.aborted) break;
      const exp = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** attempt);
      await this.sleep(Math.floor(exp * (0.5 + this.random() * 0.5)), signal);
    }
    return { ok: false, code: last, retryable: RETRYABLE_CODES.has(last) };
  }
}

function toInput(req: ConverseRequest): ConverseCommandInput {
  return {
    modelId: req.modelId,
    system: [{ text: req.system }],
    messages: req.messages.map((m) => ({
      role: m.role,
      content: m.content.map((c) =>
        c.type === 'text'
          ? { text: c.text }
          : { image: { format: c.format, source: { bytes: c.bytes } } },
      ),
    })),
    inferenceConfig: { maxTokens: req.maxTokens },
  };
}

function toResult(out: ConverseCommandOutput, modelId: string): ConverseResult {
  const blocks = out.output?.message?.content ?? [];
  const text = blocks.map((b) => ('text' in b && typeof b.text === 'string' ? b.text : '')).join('');
  return {
    ok: true,
    text,
    usage: { inputTokens: out.usage?.inputTokens ?? 0, outputTokens: out.usage?.outputTokens ?? 0 },
    modelId,
  };
}
