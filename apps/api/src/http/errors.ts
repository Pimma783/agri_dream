import type { Response } from 'express';
import { type AppError, type FieldIssue, httpStatusOf, messageThOf } from '../services/errors.js';
import type { Result } from '../services/result.js';
export function sendError(res: Response, status: number, code: string, messageTh: string): void {
  res.status(status).json({ error: { code, message_th: messageTh } });
}

/** Map a service error to the HTTP error shape `{ error: { code, message_th } }`. */
export function sendAppError(res: Response, e: AppError): void {
  const body: { code: string; message_th: string; fields?: readonly FieldIssue[]; details?: Record<string, unknown> } = {
    code: e.code,
    message_th: messageThOf(e),
  };
  if (e.fields) body.fields = e.fields;
  if (e.details) body.details = { ...e.details };
  res.status(httpStatusOf(e)).json({ error: body });
}

/** Send `Ok` as `status` JSON (default 200) or map an `Err`. */
export function sendResult<T>(res: Response, r: Result<T>, status = 200): void {
  if (r.ok) res.status(status).json(r.value);
  else sendAppError(res, r.error);
}
