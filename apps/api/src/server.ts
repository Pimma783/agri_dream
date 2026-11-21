import { loadConfig, ConfigError, lineChannelConfigs } from './config/index.js';
import { createLogger } from './logger.js';
import { createApp } from './http/app.js';
import { createPool } from './repos/index.js';
import { createAuthService, LoginRateLimiter } from './services/auth/index.js';
import { createWebhookService } from './services/index.js';
import { randomBytes } from 'node:crypto';
import { mediaRoutes } from './http/media-routes.js';
import { mountLineLinkRoutes } from './http/line-link-routes.js';
import { mountResourceRoutes } from './http/resource-routes.js';
import { mountMatchRoutes } from './http/match-routes.js';
import { mountOfferRoutes } from './http/offer-routes.js';
import { mountAgreementRoutes } from './http/agreement-routes.js';
import { mountResaleRoutes } from './http/resale-routes.js';
import { createAssessmentService, createJobQueue } from './services/index.js';

let env;
try {
  env = loadConfig();
} catch (e) {
  // Config errors name the offending value but never print secrets.
  console.error(e instanceof ConfigError ? e.message : e);
  process.exit(1);
}

const logger = createLogger(env.LOG_LEVEL);
const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : undefined;
if (!pool) logger.warn('DATABASE_URL is not set: auth routes are disabled');
const auth = pool
  ? createAuthService({
      pool,
      config: { idleMs: env.SESSION_IDLE_MINUTES * 60_000, absoluteMs: env.SESSION_ABSOLUTE_HOURS * 3_600_000 },
      limiter: new LoginRateLimiter({ maxAttempts: env.LOGIN_RATE_MAX_ATTEMPTS, windowMs: env.LOGIN_RATE_WINDOW_SECONDS * 1000 }),
    })
  : undefined;
const webhooks = pool ? { channels: lineChannelConfigs(env), service: createWebhookService({ pool }) } : undefined;
// Images: signing secret falls back to a per-process random value (links then expire on restart).
const assessment = pool
  ? createAssessmentService({
      pool, queue: createJobQueue(pool), secret: env.SESSION_SECRET ?? randomBytes(32).toString('hex'), ttlSeconds: env.MEDIA_URL_TTL_SECONDS,
      onEnqueueError: (err) => logger.error({ err }, 'assess_image enqueue failed'),
    })
  : undefined;
const app = createApp({ env, logger, auth, webhooks, mountRoutes: pool && assessment && auth ? (a) => {
    a.use(mediaRoutes(assessment));
    mountResourceRoutes(a, { pool, logger }); // drafts, listings, demands, baling (6.5)
    mountMatchRoutes(a, { pool, logger }); // GET /matches (7.3)
    mountOfferRoutes(a, { pool, logger }); // offers (8.7)
    mountAgreementRoutes(a, { pool, logger }); // agreements, parties only (8.7)
    mountResaleRoutes(a, { pool, logger }); // POST /agreements/:id/resale-draft (16.1)
    mountLineLinkRoutes(a, pool, env); // LINE link codes and status (11.2)
  } : undefined });

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'api listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
