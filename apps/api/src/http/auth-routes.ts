import { Router } from 'express';
import { z } from 'zod';
import type { AuthService } from '../services/auth/index.js';
import { sendError } from './errors.js';
import { cookieOptions, requireSession, SESSION_COOKIE, type CookieEnv } from './session.js';

const LoginBody = z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1).max(1024) }).strict();

export function authRoutes(auth: AuthService, cookie: CookieEnv): Router {
  const r = Router();

  r.post('/auth/login', async (req, res, next) => {
    try {
      const body = LoginBody.safeParse(req.body);
      if (!body.success) return sendError(res, 400, 'VALIDATION', 'ข้อมูลไม่ถูกต้อง');
      const out = await auth.login({ ...body.data, ip: req.ip ?? 'unknown' });
      if (!out.ok) {
        if (out.error.status === 429) {
          res.setHeader('Retry-After', String(out.error.retryAfterSeconds ?? 60));
          return sendError(res, 429, 'RATE_LIMITED', 'ลองใหม่อีกครั้งภายหลัง');
        }
        return sendError(res, 401, 'INVALID_CREDENTIALS', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      }
      res.cookie(SESSION_COOKIE, out.value.token, cookieOptions(req, cookie, out.value.expiresAt));
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  r.post('/auth/logout', requireSession, async (req, res, next) => {
    try {
      if (req.sessionToken) await auth.logout(req.sessionToken);
      const { expires: _e, ...opts } = cookieOptions(req, cookie);
      res.clearCookie(SESSION_COOKIE, opts);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  r.get('/me', requireSession, (req, res) => {
    const a = req.auth!;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      user: { id: a.user.id, email: a.user.email, display_name: a.user.displayName },
      org: a.org ? { id: a.org.id, kind: a.org.kind, name: a.org.name } : null,
      role: a.org?.kind ?? null,
      csrf_secret: a.csrfSecret,
      expires_at: a.expiresAt.toISOString(),
    });
  });

  return r;
}
