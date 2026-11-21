// Read and status routes shared by listings, demands, baling services and baling requests:
// GET list, GET :id, POST :id/{pause,open,close,cancel} with expectedVersion in the body.
import { Router } from 'express';
import { z } from 'zod';
import type { LifecycleService, ManagedRow } from '../services/lifecycle.js';
import { sendResult } from './errors.js';
import { actorOf, parseBody } from './route-helpers.js';
import { requireSession } from './session.js';

const TransitionBody = z.object({ expectedVersion: z.number().int().min(1) }).strict();

export function lifecycleRoutes<R extends ManagedRow>(base: string, service: LifecycleService<R>): Router {
  const r = Router();
  r.get(base, requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (actor) sendResult(res, await service.list(actor));
  });
  r.get(`${base}/:id`, requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (actor) sendResult(res, await service.get(actor, String(req.params.id)));
  });
  for (const action of ['pause', 'open', 'close', 'cancel'] as const) {
    r.post(`${base}/:id/${action}`, requireSession, async (req, res) => {
      const actor = actorOf(req, res);
      if (!actor) return;
      const body = parseBody(res, TransitionBody, req.body);
      if (!body) return;
      sendResult(res, await service[action](actor, { id: String(req.params.id), expectedVersion: body.expectedVersion }));
    });
  }
  return r;
}
