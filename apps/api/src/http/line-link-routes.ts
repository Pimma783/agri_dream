// Thin HTTP layer for LINE link codes and link status (Requirements 3.1-3.4). Rules live in services/identity.
import { type Express, Router } from 'express';
import { z } from 'zod';
import type { LineChannel, LineIdentityDeps, LineIdentityService } from '../services/identity/index.js';
import type { Env } from '../config/env.js';
import { createLineIdentityService, lineChannelOf } from '../services/identity/index.js';
import { sendError } from './errors.js';
import { requireSession } from './session.js';

const Body = z.object({ channel: z.enum(['farmer', 'baler', 'factory']) }).strict();
const FORBIDDEN_TH = 'ไม่สามารถสร้างรหัสผูกบัญชีได้';

/** Public Basic IDs of the Official Accounts, from server config. Not secrets. */
export type LineBasicIds = Partial<Record<LineChannel, string | undefined>>;

export function lineLinkRoutes(identity: LineIdentityService, basicIds: LineBasicIds = {}): Router {
  const r = Router();

  r.get('/line-identities', requireSession, async (req, res, next) => {
    try {
      const actor = req.auth?.actor ?? null;
      if (!actor) return sendError(res, 403, 'FORBIDDEN', FORBIDDEN_TH);
      const items = (await identity.lineLinkStatus(actor)).map((s) => ({
        channel: s.channel,
        status: s.linked ? 'LINKED' : 'UNLINKED',
        basic_id: basicIds[s.channel] ?? null,
      }));
      res.setHeader('Cache-Control', 'no-store');
      res.json({ items });
    } catch (e) {
      next(e);
    }
  });

  r.post('/line-link-codes', requireSession, async (req, res, next) => {
    try {
      const actor = req.auth?.actor ?? null;
      if (!actor) return sendError(res, 403, 'FORBIDDEN', FORBIDDEN_TH);
      const body = Body.safeParse(req.body);
      if (!body.success) return sendError(res, 400, 'VALIDATION', 'ข้อมูลไม่ถูกต้อง');
      // A member can only link the Official Account of their own role.
      if (body.data.channel !== lineChannelOf(actor.role)) return sendError(res, 403, 'FORBIDDEN', FORBIDDEN_TH);
      const out = await identity.issueLinkCode(actor);
      if (!out.ok) return sendError(res, 403, 'FORBIDDEN', FORBIDDEN_TH);
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json({
        channel: body.data.channel,
        code: out.value.code,
        expires_at: out.value.expiresAt.toISOString(),
        basic_id: basicIds[body.data.channel] ?? null,
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}

/** Wires the identity service from config. Called once from server.ts. */
export function mountLineLinkRoutes(app: Express, pool: LineIdentityDeps['pool'], env: Env): void {
  const identity = createLineIdentityService({ pool, config: { linkCodeTtlMs: env.LINK_CODE_TTL_MINUTES * 60_000 } });
  app.use(lineLinkRoutes(identity, {
    farmer: env.LINE_FARMER_BASIC_ID, baler: env.LINE_BALER_BASIC_ID, factory: env.LINE_FACTORY_BASIC_ID,
  }));
}
