// Session middleware: builds req.auth from the cookie. The client never supplies role or org (Requirement 1.7).
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthService, AuthSession } from '../services/auth/index.js';
import { sendError } from './errors.js';

export const SESSION_COOKIE = 'agrimatch_sid';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthSession;
    sessionToken?: string;
  }
}

/** Minimal Cookie header parser: returns the first value of `name`, or undefined. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    const raw = part.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface CookieEnv {
  production: boolean;
}
/** HttpOnly, SameSite=Lax, Path=/. Secure in production or when the (trusted-proxy) request is HTTPS. */
export function cookieOptions(req: Request, cookie: CookieEnv, expiresAt?: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: cookie.production || req.secure,
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

const isWebhook = (path: string) => path.startsWith('/webhooks/');

export function sessionMiddleware(auth: AuthService, cookie: CookieEnv): RequestHandler {
  return (req, res, next) => {
    if (isWebhook(req.path)) return next(); // authenticated by signature, not by session
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) return next();
    auth
      .resolveSession(token)
      .then((session) => {
        if (session) {
          req.auth = session;
          req.sessionToken = token;
          if (session.extended) res.cookie(SESSION_COOKIE, token, cookieOptions(req, cookie, session.expiresAt));
        }
        next();
      })
      .catch(next);
  };
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) return sendError(res, 401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
  next();
}
