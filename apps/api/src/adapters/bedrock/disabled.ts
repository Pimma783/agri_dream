import type { BedrockPort, ConverseResult } from './port.js';

/**
 * Used when ENABLE_REAL_BEDROCK=false and no test adapter is injected. It makes no call and
 * always fails closed, so the orchestrator falls back to the step form (Requirement 4.11).
 * Its kind is 'mock' so /healthz never reports a real integration.
 */
export class DisabledBedrock implements BedrockPort {
  readonly kind = 'mock' as const;
  converse(): Promise<ConverseResult> {
    return Promise.resolve({ ok: false, code: 'DISABLED', retryable: false });
  }
}
