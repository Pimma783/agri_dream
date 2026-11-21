// /drafts: create, read, patch, publish (human confirmation) and cancel. All rules live in services/drafts.
import { Router } from 'express';
import { z } from 'zod';
import { DRAFT_KINDS, type DraftService } from '../services/index.js';
import { sendResult } from './errors.js';
import { actorOf, parseBody } from './route-helpers.js';
import { requireSession } from './session.js';

const Version = z.number().int().min(1);
const CreateBody = z.object({ kind: z.enum(DRAFT_KINDS), patch: z.record(z.string(), z.unknown()).optional() }).strict();
const PatchBody = z.object({ expectedVersion: Version, patch: z.record(z.string(), z.unknown()) }).strict();
const VersionBody = z.object({ expectedVersion: Version }).strict();

export function draftRoutes(service: DraftService): Router {
  const r = Router();
  r.get('/drafts', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (actor) sendResult(res, await service.list(actor));
  });
  r.post('/drafts', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    const body = parseBody(res, CreateBody, req.body);
    if (!body) return;
    sendResult(res, await service.create(actor, { kind: body.kind, ...(body.patch ? { patch: body.patch } : {}) }), 201);
  });
  r.get('/drafts/:id', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (actor) sendResult(res, await service.get(actor, String(req.params.id)));
  });
  r.patch('/drafts/:id', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    const body = parseBody(res, PatchBody, req.body);
    if (!body) return;
    sendResult(res, await service.patch(actor, { draftId: String(req.params.id), ...body }));
  });
  r.post('/drafts/:id/publish', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    const body = parseBody(res, VersionBody, req.body);
    if (!body) return;
    const key = req.header('idempotency-key');
    const out = await service.publish(actor, {
      draftId: String(req.params.id), expectedVersion: body.expectedVersion, ...(key !== undefined ? { idempotencyKey: key } : {}),
    });
    sendResult(res, out);
  });
  r.post('/drafts/:id/cancel', requireSession, async (req, res) => {
    const actor = actorOf(req, res);
    if (!actor) return;
    const body = parseBody(res, VersionBody, req.body);
    if (!body) return;
    sendResult(res, await service.cancel(actor, { draftId: String(req.params.id), expectedVersion: body.expectedVersion }));
  });
  return r;
}
