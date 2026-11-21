// GET /notifications, POST /notifications/:id/read, POST /notifications/read-all (task 23.1).
import { type Express, Router } from 'express';
import type { ServiceContext } from '../services/context.js';
import { createNotificationService, type NotificationService } from '../services/notifications/index.js';
import { sendResult } from './errors.js';
import { actorOf } from './route-helpers.js';
import { requireSession } from './session.js';

export function notificationRoutes(service: NotificationService): Router {
  const r = Router();
  r.get('/notifications', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    sendResult(res, await service.list(actor));
  });
  // Registered before the :id route so "read-all" is never taken as an id.
  r.post('/notifications/read-all', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    sendResult(res, await service.markAllRead(actor));
  });
  r.post('/notifications/:id/read', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    sendResult(res, await service.markRead(actor, String(req.params.id)));
  });
  return r;
}

export function mountNotificationRoutes(app: Express, ctx: ServiceContext): void {
  app.use(notificationRoutes(createNotificationService(ctx)));
}
