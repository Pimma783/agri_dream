import type { Env } from '../../config/env.js';
import { lineChannelConfigs } from '../../config/line.js';
import { FakeLineClient } from './fake.js';
import { HttpLineClient, type HttpLineClientOptions } from './http.js';
import { LINE_CHANNEL_KEYS, type LineClient } from './port.js';

/**
 * Production wiring. The fake is used unless ENABLE_REAL_LINE is true.
 * With the flag on, all three channels need a secret and an access token, otherwise this throws
 * (the message names the roles, never the values).
 */
export function selectLineClient(
  env: Env,
  override?: LineClient,
  options?: Pick<HttpLineClientOptions, 'fetch' | 'timeoutMs' | 'maxContentBytes'>,
): LineClient {
  if (override) return override;
  if (!env.ENABLE_REAL_LINE) return new FakeLineClient();
  const configs = lineChannelConfigs(env);
  const missing = LINE_CHANNEL_KEYS.filter((k) => !configs[k]);
  if (missing.length > 0) throw new Error(`ENABLE_REAL_LINE=true but LINE secret/token missing for: ${missing.join(', ')}`);
  const tokens = Object.fromEntries(LINE_CHANNEL_KEYS.map((k) => [k, configs[k]!.accessToken]));
  return new HttpLineClient({ tokens, ...options });
}
