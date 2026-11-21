// /offers: create, list, read, accept, reject, withdraw, edit (task 8.7). Rules live in services/offers.
// Idempotency-Key is read from the header and passed to the service; the actor always comes from the session.
import { type Express, type Request, Router } from 'express';
import { z } from 'zod';
import type { ServiceContext } from '../services/context.js';
import { appError } from '../services/errors.js';
import {
  type AcceptResult, createOfferService, type OfferResult, type OfferService, toAgreementViewFor, toOfferView,
} from '../services/index.js';
import { mapResult, type Result } from '../services/result.js';
import { sendAppError, sendResult } from './errors.js';
import { actorOf, parseBody } from './route-helpers.js';
import { requireSession } from './session.js';

const Version = z.number().int().min(1);
/** Terms are validated by the service's strict schema; the route only requires a JSON object. */
const ObjectBody = z.record(z.string(), z.unknown());
const RefBody = z.object({ expectedVersion: Version.optional() }).strict();
const AcceptBody = z.object({ ackPendingMaterial: z.boolean().optional() }).strict();
const EditBody = z.object({ expectedVersion: Version, changes: z.record(z.string(), z.unknown()) }).strict();
const ListQuery = z.object({ status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED']).optional(), direction: z.enum(['sent', 'received']).optional() }).strict();

const keyOf = (req: Request) => {
  const key = req.header('idempotency-key');
  return key !== undefined ? { idempotencyKey: key } : {};
};

export function offerRoutes(service: OfferService): Router {
  const r = Router();
  const respond = (res: Parameters<typeof sendResult>[0], orgId: string, out: Result<OfferResult>, created = false) => {
    const view = mapResult(out, (v) => ({
      offer: toOfferView(v.offer, orgId),
      ...(v.replaced ? { replaced: toOfferView(v.replaced, orgId) } : {}),
      replayed: v.replayed,
    }));
    sendResult(res, view, created && out.ok && !out.value.replayed ? 201 : 200);
  };

  r.post('/offers', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    const body = parseBody(res, ObjectBody, req.body);
    if (!body) return;
    respond(res, actor.orgId, await service.create(actor, body as never, keyOf(req)), true);
  });

  r.get('/offers', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    const q = ListQuery.safeParse({ ...req.query });
    if (!q.success) {
      return sendAppError(res, appError('VALIDATION', { fields: q.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }));
    }
    const filter = { ...(q.data.status ? { status: q.data.status } : {}), ...(q.data.direction ? { direction: q.data.direction } : {}) };
    sendResult(res, mapResult(await service.list(actor, filter), (rows) => rows.map((o) => toOfferView(o, actor.orgId))));
  });

  r.get('/offers/:id', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    sendResult(res, mapResult(await service.get(actor, String(req.params.id)), (o) => toOfferView(o, actor.orgId)));
  });

  r.post('/offers/:id/accept', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    const body = parseBody(res, AcceptBody, req.body);
    if (!body) return;
    const out = await service.accept(actor, {
      offerId: String(req.params.id), ...keyOf(req), ...(body.ackPendingMaterial !== undefined ? { ackPendingMaterial: body.ackPendingMaterial } : {}),
    });
    sendResult(res, mapResult(out, (v) => {
      const a = v as AcceptResult;
      return { agreement: toAgreementViewFor(a.agreement, actor.orgId), offer: toOfferView(a.offer, actor.orgId), replayed: a.replayed };
    }));
  });

  for (const action of ['reject', 'withdraw'] as const) {
    r.post(`/offers/:id/${action}`, requireSession, async (req, res) => {
      const actor = actorOf(req, res);
      if (!actor) return;
      const body = parseBody(res, RefBody, req.body);
      if (!body) return;
      const input = { offerId: String(req.params.id), ...(body.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}) };
      respond(res, actor.orgId, await service[action](actor, input, keyOf(req)));
    });
  }

  r.post('/offers/:id/edit', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    const body = parseBody(res, EditBody, req.body);
    if (!body) return;
    const out: Result<OfferResult> = await service.edit(actor, { offerId: String(req.params.id), expectedVersion: body.expectedVersion, changes: body.changes as never }, keyOf(req));
    respond(res, actor.orgId, out, true);
  });
  return r;
}

export function mountOfferRoutes(app: Express, ctx: ServiceContext): void {
  app.use(offerRoutes(createOfferService(ctx)));
}
