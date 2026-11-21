import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { signBody } from '../src/channels/line/signature.js';
import { EnvSchema } from '../src/config/env.js';
import type { LineChannelConfig, LineChannelKey } from '../src/config/line.js';
import { createApp } from '../src/http/app.js';
import { createLogger } from '../src/logger.js';
import type { WebhookService } from '../src/services/webhooks/index.js';
// Synthetic secrets only. Real values are never read in tests.
export const SECRETS: Record<LineChannelKey, string> = {
  farmer: 'synthetic-farmer-secret', baler: 'synthetic-baler-secret', factory: 'synthetic-factory-secret',
};
export const channels = Object.fromEntries(
  (Object.keys(SECRETS) as LineChannelKey[]).map((k) => [k, { channelKey: k, channelSecret: SECRETS[k], accessToken: `synthetic-${k}-token` }]),
) as Record<LineChannelKey, LineChannelConfig>;
export async function startApp(service: WebhookService): Promise<{ base: string; server: Server }> {
  const env = EnvSchema.parse({ NODE_ENV: 'test' });
  const app = createApp({ env, logger: createLogger('silent'), webhooks: { channels, service } });
  const server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}
export const post = (base: string, role: string, body: string, sig: string | undefined, type = 'application/json') =>
  fetch(`${base}/webhooks/line/${role}`, {
    method: 'POST', headers: { 'content-type': type, ...(sig === undefined ? {} : { 'x-line-signature': sig }) }, body,
  });
export const sign = (role: LineChannelKey, body: string) => signBody(SECRETS[role], Buffer.from(body));
export const evt = (id: string) => ({ type: 'message', webhookEventId: id, timestamp: 1, source: { type: 'user', userId: 'U-synthetic' }, message: { type: 'text', text: 'hi' } });
