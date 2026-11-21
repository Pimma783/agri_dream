import { randomUUID } from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import { adapterKinds } from '../adapters/kinds.js';
import type { AuthService } from '../services/auth/index.js';
import { authRoutes } from './auth-routes.js';
import { csrfMiddleware } from './csrf.js';
import { sessionMiddleware } from './session.js';
import { webhookRawBody, webhookRoutes, type WebhookDeps } from './webhook-routes.js';

export interface AppDeps {
  env: Env;
  logger: Logger;
  /** When absent (no database configured) the auth routes are not mounted. */
  auth?: AuthService | undefined;
  /** LINE webhooks. When absent, /webhooks/line/* is not mounted. */
  webhooks?: WebhookDeps | undefined;
  /** Mounts extra routes after auth and before the 404 handler. */
  mountRoutes?: ((app: Express) => void) | undefined;
}

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

export function createApp({ env, logger, auth, webhooks, mountRoutes }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind Next.js rewrite / a proxy; needed for Secure cookies and client IPs later.
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });

  // Response body only; never logs headers, bodies or query strings.
  app.use((req, res, next) => {
    res.on('finish', () => {
      logger.info(
        { requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode },
        'request',
      );
    });
    next();
  });

  // Webhooks keep the raw body for signature checks, so they mount before express.json.
  if (webhooks) {
    app.use('/webhooks/line', webhookRawBody);
    app.use(webhookRoutes(webhooks));
  }
  app.use(express.json({ limit: '1mb' }));
  if (auth) {
    const cookie = { production: env.NODE_ENV === 'production' };
    app.use(sessionMiddleware(auth, cookie));
    app.use(csrfMiddleware(env.WEB_ORIGIN));
    app.use(authRoutes(auth, cookie));
  }

  // Prints adapter kinds only. No secrets, no URLs, no credentials.
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', env: env.NODE_ENV, adapters: adapterKinds(env) });
  });

  mountRoutes?.(app);
  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message_th: 'ไม่พบข้อมูลที่ต้องการ' } });
    void req;
  });

  // Generic 500 with request ID; error details go to the log only.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ requestId: req.requestId, err }, 'unhandled error');
    res.status(500).json({
      error: { code: 'INTERNAL', message_th: 'ระบบขัดข้อง กรุณาลองใหม่', details: { requestId: req.requestId } },
    });
  });

  return app;
}
