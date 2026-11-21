import { LOGIN_EXPIRED_PATH } from './api-core';
/** Must match SESSION_COOKIE in apps/api/src/http/session.ts. */
export const SESSION_COOKIE_NAME = 'agrimatch_sid';
/**
 * Where to send a visitor the API refused (401). The «เซสชันหมดอายุ» banner is only right when the request carried
 * a session cookie that the API no longer accepts. A first visit has no cookie and goes to a plain /login.
 */
export function loginPathFor(cookieHeader: string): string {
  const hadSession = cookieHeader.split(';').some((c) => c.trim().startsWith(`${SESSION_COOKIE_NAME}=`));
  return hadSession ? LOGIN_EXPIRED_PATH : '/login';
}
