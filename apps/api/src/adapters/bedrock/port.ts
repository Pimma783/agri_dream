// Bedrock port (design.md "Bedrock adapter"). No SDK import here: the real adapter is task 10.4.
export type AdapterKind = 'real' | 'mock';

export type ConverseContent =
  | { type: 'text'; text: string }
  | { type: 'image'; format: 'jpeg' | 'png'; bytes: Uint8Array };

/**
 * `system` holds fixed rules and the output schema only. User text, image-derived text and
 * conversation history go in `messages` (user turns), never in `system` (Requirement 4.10).
 */
export interface ConverseRequest {
  modelId: string;
  system: string;
  messages: ReadonlyArray<{ role: 'user'; content: ReadonlyArray<ConverseContent> }>;
  maxTokens: number;
}

export type ConverseErrorCode =
  | 'TIMEOUT'
  | 'THROTTLED'
  | 'ACCESS_DENIED'
  | 'MODEL_UNSUPPORTED'
  | 'INVALID_REQUEST'
  | 'UPSTREAM_5XX'
  | 'DISABLED';

export type ConverseResult =
  | {
      ok: true;
      text: string;
      usage: { inputTokens: number; outputTokens: number };
      modelId: string;
    }
  | { ok: false; code: ConverseErrorCode; retryable: boolean };

export interface BedrockPort {
  readonly kind: AdapterKind;
  converse(req: ConverseRequest, signal: AbortSignal): Promise<ConverseResult>;
}

/** Errors that the caller may retry (design: TIMEOUT, THROTTLED, UPSTREAM_5XX only). */
export const RETRYABLE_CODES: ReadonlySet<ConverseErrorCode> = new Set([
  'TIMEOUT',
  'THROTTLED',
  'UPSTREAM_5XX',
]);
