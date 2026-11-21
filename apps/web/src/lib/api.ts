// Browser API client. Calls go to the web origin (/api/*); Next.js rewrites to Express,
// so the session cookie stays first-party. State-changing calls send X-CSRF-Token
// (from GET /api/me) and the browser adds the same-origin Origin header.
import { createApiCore, LOGIN_EXPIRED_PATH, SessionExpiredError } from './api-core';

export const browserApi = createApiCore({ baseUrl: '/api', credentials: 'same-origin' });
export const getMe = browserApi.getMe;

/** Client-side helper: on an expired session go to the login page. Returns true if it redirected. */
export function handleSessionExpired(error: unknown, navigate: (path: string) => void = (p) => window.location.assign(p)): boolean {
  if (error instanceof SessionExpiredError) {
    navigate(LOGIN_EXPIRED_PATH);
    return true;
  }
  return false;
}
