// POST /agreements/:id/resale-draft: a BALER buyer creates a resale draft from a confirmed purchase (task 16.1).
import { type Express, Router } from 'express';
import { z } from 'zod';
import type { ServiceContext } from '../services/context.js';
import { createResaleService, type ResaleService } from '../services/index.js';
import { sendResult } from './errors.js';
import { actorOf, parseBody } from './route-helpers.js';
import { requireSession } from './session.js';

const Body = z.object({ qtyKg: z.string().max(20).optional() }).strict();

export function resaleRoutes(service: ResaleService): Router {
  const r = Router();
  r.post('/agreements/:id/resale-draft', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    const body = parseBody(res, Body, req.body);
    if (!body) return;
    sendResult(res, await service.createDraft(actor, { agreementId: String(req.params.id), ...(body.qtyKg !== undefined ? { qtyKg: body.qtyKg } : {}) }), 201);
  });
  return r;
}

export function mountResaleRoutes(app: Express, ctx: ServiceContext): void {
  app.use(resaleRoutes(createResaleService(ctx)));
}
