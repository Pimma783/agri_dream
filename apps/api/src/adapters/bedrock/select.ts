import type { Env } from '../../config/env.js';
import { DisabledBedrock } from './disabled.js';
import type { BedrockPort } from './port.js';
import { RealBedrock, type RealBedrockOptions } from './real.js';

/**
 * Production wiring. It never imports the scripted mock (that lives behind `test-support.ts`).
 * Tests that want scripted output pass their own port through `override`.
 */
export function selectBedrockAdapter(
  env: Pick<Env, 'ENABLE_REAL_BEDROCK'> & Partial<Pick<Env, 'AWS_REGION'>>,
  override?: BedrockPort,
  realOptions?: Partial<RealBedrockOptions>,
): BedrockPort {
  if (override) return override;
  if (!env.ENABLE_REAL_BEDROCK) return new DisabledBedrock();
  return new RealBedrock({ region: env.AWS_REGION ?? 'ap-southeast-1', ...realOptions });
}
