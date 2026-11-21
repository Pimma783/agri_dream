import type { Env } from './env.js';
export const LINE_CHANNEL_KEYS = ['farmer', 'baler', 'factory'] as const;
export type LineChannelKey = (typeof LINE_CHANNEL_KEYS)[number];
export interface LineChannelConfig {
  channelKey: LineChannelKey;
  channelSecret: string;
  accessToken: string;
}
/** Per-role LINE config from env. A role without both a secret and a token is absent. */
export function lineChannelConfigs(env: Env): Partial<Record<LineChannelKey, LineChannelConfig>> {
  const pick: Record<LineChannelKey, [string | undefined, string | undefined]> = {
    farmer: [env.LINE_FARMER_CHANNEL_SECRET, env.LINE_FARMER_ACCESS_TOKEN],
    baler: [env.LINE_BALER_CHANNEL_SECRET, env.LINE_BALER_ACCESS_TOKEN],
    factory: [env.LINE_FACTORY_CHANNEL_SECRET, env.LINE_FACTORY_ACCESS_TOKEN],
  };
  const out: Partial<Record<LineChannelKey, LineChannelConfig>> = {};
  for (const key of LINE_CHANNEL_KEYS) {
    const [channelSecret, accessToken] = pick[key];
    if (channelSecret && accessToken) out[key] = { channelKey: key, channelSecret, accessToken };
  }
  return out;
}
