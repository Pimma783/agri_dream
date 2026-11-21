import { selectLineClient } from './adapters/line/index.js';
import { loadConfig, ConfigError } from './config/index.js';
import { resolveAiMode } from './config/env.js';
import { composeAssistant, createImageAssessor } from './assistant/index.js';
import { createBalerHandler, createFactoryHandler, createFarmerHandler, createFarmerImageHook, createLineGateway } from './channels/index.js';
import { selectBedrockAdapter } from './adapters/bedrock/index.js';
import { HandlerRegistry, JobRunner, createExpireOffersSweeper, OutboxSender, SweeperSchedule, createWorkerLoop, registerAssessImage, registerLineEvent } from './jobs/index.js';
import { registerRecomputeMatches } from './jobs/recompute-matches.js';
import { createLogger } from './logger.js';
import { createPool } from './repos/index.js';
import { createMatchingService } from './services/matching/index.js';
import {
  createAssessmentService, createBalingRequestService, createConversationService, createListingService, createDraftService, createJobQueue, createLineEventStore, createMatchReadService,
  createOfferService, createOutboxQueue,
} from './services/index.js';
import { createLineIdentityService } from './services/identity/index.js';
let env;
try {
  env = loadConfig();
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : e);
  process.exit(1);
}
const logger = createLogger(env.LOG_LEVEL);
const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : undefined;
let loop: ReturnType<typeof createWorkerLoop> | undefined;
let keepAlive: NodeJS.Timeout | undefined;
let line: ReturnType<typeof selectLineClient> | undefined;
let lineError: string | undefined;
try {
  line = selectLineClient(env);
} catch (e) {
  lineError = e instanceof Error ? e.message : 'LINE client unavailable';
}
if (!pool) {
  logger.warn('DATABASE_URL is not set: worker is idle');
  keepAlive = setInterval(() => {}, 60_000);
} else if (!line) {
  // The worker must not pretend to deliver messages without a usable LINE client.
  logger.error(`${lineError}: worker is idle`);
  keepAlive = setInterval(() => {}, 60_000);
} else {
  // Each handler is registered once here. The sweeper for expire_offers is below.
  const handlers = new HandlerRegistry();
  registerAssessImage(handlers, {
    assessment: createAssessmentService({ pool, queue: createJobQueue(pool), secret: 'worker-unused', ttlSeconds: env.MEDIA_URL_TTL_SECONDS }),
    assessor: createImageAssessor({ bedrock: selectBedrockAdapter(env), modelId: env.BEDROCK_VISION_MODEL_ID, enabled: env.VISION_ENABLED }),
  });
  registerRecomputeMatches(handlers, { matching: createMatchingService({ pool, logger }) });
  const drafts = createDraftService({ pool });
  const conversations = createConversationService({ pool });
  const identity = createLineIdentityService({ pool, config: { linkCodeTtlMs: env.LINK_CODE_TTL_MINUTES * 60_000 } });
  const farmerLine = line.forChannel('farmer');
  const dashboardOffers = createOfferService({ pool }, { defaultExpiryHours: env.OFFER_EXPIRY_HOURS });
  const dashboardMatches = createMatchReadService({ pool });
  registerLineEvent(handlers, {
    gateway: createLineGateway({
      events: createLineEventStore({ pool }),
      line,
      log: (obj, msg) => logger.warn(obj, msg),
      handlers: {
        farmer: createFarmerHandler({
          identity, drafts, conversations,
          assistant: composeAssistant({ env, drafts, conversations, matches: createMatchReadService({ pool }) }),
          offers: createOfferService({ pool }, { defaultExpiryHours: env.OFFER_EXPIRY_HOURS }),
          listings: createListingService({ pool }),
          balingRequests: createBalingRequestService({ pool }),
          aiEnabled: () => resolveAiMode(env) === 'enabled',
          onImage: createFarmerImageHook({
            getContent: async (id) => (await farmerLine.getContent?.(id)) ?? { ok: false, code: 'INVALID_REQUEST' },
            assessment: createAssessmentService({ pool, queue: createJobQueue(pool), secret: 'worker-unused', ttlSeconds: env.MEDIA_URL_TTL_SECONDS }),
            drafts, conversations,
          }),
        }),
        baler: createBalerHandler({ identity, offers: dashboardOffers, matches: dashboardMatches, webOrigin: env.WEB_ORIGIN }),
        factory: createFactoryHandler({ identity, offers: dashboardOffers, matches: dashboardMatches, webOrigin: env.WEB_ORIGIN }),
      },
    }),
  });
  const runner = new JobRunner({ queue: createJobQueue(pool), handlers, logger });
  const sender = new OutboxSender({ queue: createOutboxQueue(pool), line, logger });
  const sweepers = new SweeperSchedule(
    [createExpireOffersSweeper(createOfferService({ pool }, { defaultExpiryHours: env.OFFER_EXPIRY_HOURS }))],
    undefined,
    logger,
  );
  loop = createWorkerLoop({ runner, sender, sweepers, logger });
  loop.start();
  logger.info({ line: line.kind }, 'worker started');
}
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker shutting down');
  if (keepAlive) clearInterval(keepAlive);
  await loop?.stop();
  await pool?.end();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
