// GET /agreements and GET /agreements/:id: visible to the two parties only (task 8.7).
import { type Express, Router } from 'express';
import type { ServiceContext } from '../services/context.js';
import { type AgreementReadService, createAgreementReadService, toAgreementViewFor } from '../services/index.js';
import { mapResult } from '../services/result.js';
import { sendResult } from './errors.js';
import { actorOf } from './route-helpers.js';
import { requireSession } from './session.js';

export function agreementRoutes(service: AgreementReadService): Router {
  const r = Router();
  r.get('/agreements', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (actor) sendResult(res, mapResult(await service.list(actor, { ...req.query }), (rows) => rows.map((a) => toAgreementViewFor(a, actor.orgId))));
  });
  r.get('/agreements/:id', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (actor) sendResult(res, mapResult(await service.get(actor, String(req.params.id)), (a) => toAgreementViewFor(a, actor.orgId)));
  });
  return r;
}

export function mountAgreementRoutes(app: Express, ctx: ServiceContext): void {
  app.use(agreementRoutes(createAgreementReadService(ctx)));
}
