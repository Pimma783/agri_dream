// Production-facing exports. The mock is intentionally absent: see test-support.ts.
export type {
  AdapterKind,
  BedrockPort,
  ConverseContent,
  ConverseErrorCode,
  ConverseRequest,
  ConverseResult,
} from './port.js';
export { RETRYABLE_CODES } from './port.js';
export { DisabledBedrock } from './disabled.js';
export { selectBedrockAdapter } from './select.js';
export { RealBedrock, classifyError } from './real.js';
export type { ConverseClient, RealBedrockOptions } from './real.js';
