// GET /matches: the actor's own side with the counterparty's published fields only (task 7.3).
import { type Express, Router } from 'express';
import type { ServiceContext } from '../services/context.js';
import { createMatchReadService, type MatchReadService } from '../services/matches/index.js';
import { sendResult } from './errors.js';
import { actorOf } from './route-helpers.js';
import { requireSession } from './session.js';

export function matchRoutes(service: MatchReadService): Router {
  const r = Router();
  r.get('/matches', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    // Unknown keys and bad values are rejected by the service's strict schema (422 VALIDATION).
    sendResult(res, await service.list(actor, { ...req.query } as Record<string, never>));
  });
  return r;
}

export function mountMatchRoutes(app: Express, ctx: ServiceContext): void {
  app.use(matchRoutes(createMatchReadService(ctx)));
}
