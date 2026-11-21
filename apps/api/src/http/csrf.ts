// CSRF for cookie sessions (Requirement 3.6): allowed Origin plus X-CSRF-Token equal to the session's csrf_secret.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { sendError } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const digest = (v: string) => createHash('sha256').update(v).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

const CSRF_MESSAGE = 'คำขอไม่ผ่านการตรวจสอบความปลอดภัย';

export function csrfMiddleware(webOrigin: string): RequestHandler {
  const allowed = new URL(webOrigin).origin;
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    // LINE webhooks carry a signature instead of a cookie.
    if (req.path.startsWith('/webhooks/')) return next();
    const origin = req.headers.origin;
    if (req.path === '/auth/login') {
      // No session exists yet, so there is no token. A browser always sends Origin on a cross-site POST;
      // reject a foreign one so another site cannot log a visitor in to an attacker's account.
      if (origin !== undefined && origin !== allowed) return sendError(res, 403, 'CSRF', CSRF_MESSAGE);
      return next();
    }
    if (!req.auth) return sendError(res, 401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
    if (origin !== allowed) return sendError(res, 403, 'CSRF', CSRF_MESSAGE);
    const token = req.headers['x-csrf-token'];
    if (typeof token !== 'string' || token === '' || !sameSecret(token, req.auth.csrfSecret)) {
      return sendError(res, 403, 'CSRF', CSRF_MESSAGE);
    }
    next();
  };
}
