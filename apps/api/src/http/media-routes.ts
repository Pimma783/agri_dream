// Thin HTTP layer for images (Requirement 8). Every rule lives in services/assessment and services/media.
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { MAX_MEDIA_BYTES } from '../domain/media.js';
import { MediaServiceError } from '../services/media/index.js';
import type { AssessmentService } from '../services/index.js';
import { sendError } from './errors.js';
import { requireSession } from './session.js';
const MESSAGE_TH: Record<string, string> = {
  FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  NOT_FOUND: 'ไม่พบข้อมูล',
  INVALID_TOKEN: 'ลิงก์รูปภาพไม่ถูกต้องหรือหมดอายุ',
  EMPTY: 'ไม่พบไฟล์รูปภาพ',
  UNSUPPORTED_TYPE: 'รองรับเฉพาะรูป JPEG หรือ PNG',
  TOO_LARGE: 'ไฟล์ใหญ่เกิน 5 MB',
};
const Query = z.object({ owner_type: z.enum(['DRAFT', 'LISTING']), owner_id: z.string().uuid() });
const MediaId = z.string().uuid();
/** Raw body, any content type: the declared type is ignored and the bytes are sniffed by the service. */
const rawBody = express.raw({ type: () => true, limit: MAX_MEDIA_BYTES });
export function mediaRoutes(assessment: AssessmentService): Router {
  const r = Router();
  const actorOf = (req: Request, res: Response) => {
    const actor = req.auth?.actor ?? null;
    if (!actor) sendError(res, 403, 'FORBIDDEN', MESSAGE_TH.FORBIDDEN!);
    return actor;
  };
  r.post('/media', requireSession, rawBody, async (req, res, next) => {
    try {
      const actor = actorOf(req, res);
      if (!actor) return;
      const q = Query.safeParse(req.query);
      if (!q.success) return sendError(res, 422, 'VALIDATION', 'ข้อมูลไม่ถูกต้อง');
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const out = await assessment.upload(actor, { ownerType: q.data.owner_type, ownerId: q.data.owner_id, bytes });
      // Accepted: the assessment is queued and the listing can publish without it.
      res.status(202).json({
        media_id: out.mediaId, content_type: out.contentType, size_bytes: out.sizeBytes, duplicate: out.duplicate,
        assessment_status: 'PENDING',
      });
    } catch (e) {
      next(e);
    }
  });
  r.get('/media/:id/url', requireSession, async (req, res, next) => {
    try {
      const actor = actorOf(req, res);
      if (!actor) return;
      const id = MediaId.safeParse(req.params.id);
      if (!id.success) return sendError(res, 404, 'NOT_FOUND', MESSAGE_TH.NOT_FOUND!);
      const u = await assessment.media.getMediaUrl(actor, id.data);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ url: u.url, expires_at: u.expiresAt.toISOString() });
    } catch (e) {
      next(e);
    }
  });
  // Session is required even with a token: the signed link bounds its lifetime, the session proves the right.
  r.get('/media/:id/content', requireSession, async (req, res, next) => {
    try {
      const actor = actorOf(req, res);
      if (!actor) return;
      const id = MediaId.safeParse(req.params.id);
      if (!id.success) return sendError(res, 404, 'NOT_FOUND', MESSAGE_TH.NOT_FOUND!);
      const token = typeof req.query.token === 'string' ? req.query.token : undefined;
      const c = await assessment.media.getContent(actor, id.data, token);
      res.setHeader('Content-Type', c.contentType);
      res.setHeader('Content-Length', String(c.sizeBytes));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).end(c.bytes);
    } catch (e) {
      next(e);
    }
  });
  r.get('/media/:id/assessment', requireSession, async (req, res, next) => {
    try {
      const actor = actorOf(req, res);
      if (!actor) return;
      const id = MediaId.safeParse(req.params.id);
      if (!id.success) return sendError(res, 404, 'NOT_FOUND', MESSAGE_TH.NOT_FOUND!);
      res.setHeader('Cache-Control', 'no-store');
      res.json(await assessment.get(actor, id.data));
    } catch (e) {
      next(e);
    }
  });
  // Errors from this router only; anything else falls through to the app's generic 500.
  r.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof MediaServiceError) return sendError(res, err.status, err.code, MESSAGE_TH[err.code] ?? 'ไม่สำเร็จ');
    if ((err as { type?: string }).type === 'entity.too.large') return sendError(res, 413, 'TOO_LARGE', MESSAGE_TH.TOO_LARGE!);
    next(err);
  });
  return r;
}
