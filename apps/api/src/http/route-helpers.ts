// Shared helpers for resource routes: actor from the session (never from the client), Zod body parsing
// into the standard VALIDATION error. Routes call services only (design.md "Module boundaries").
import type { Request, Response } from 'express';
import type { ZodType } from 'zod';
import type { Actor } from '../domain/permissions.js';
import { appError } from '../services/errors.js';
import { sendAppError, sendError } from './errors.js';

/** The session actor (channel 'web'). Sends 403 and returns null when the user has no organization. */
export function actorOf(req: Request, res: Response): Actor | null {
  const actor = req.auth?.actor ?? null;
  if (!actor) sendError(res, 403, 'FORBIDDEN', 'คุณไม่มีสิทธิ์ทำรายการนี้');
  return actor;
}

/** Parse `value` with `schema`; on failure send 422 VALIDATION with field paths and return undefined. */
export function parseBody<T>(res: Response, schema: ZodType<T>, value: unknown): T | undefined {
  const p = schema.safeParse(value ?? {});
  if (p.success) return p.data;
  sendAppError(
    res,
    appError('VALIDATION', { fields: p.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }),
  );
  return undefined;
}
