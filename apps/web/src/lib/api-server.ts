import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { MeResponse } from '@agrimatch/contracts';
import type { z } from 'zod';
import { ApiRequestError, createApiCore, SessionExpiredError } from './api-core';
import { loginPathFor } from './login-path';

// Server components call the API directly at API_INTERNAL_URL (the target of the /api rewrite;
// server-side only, no NEXT_PUBLIC_ prefix) and forward the user's cookie.
function internalUrl(): string {
  return (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
}

async function loginPath(): Promise<string> {
  return loginPathFor((await cookies()).toString());
}
/** One client per request: it forwards that request's cookie and caches its own CSRF secret. */
export async function serverApi() {
  const cookieHeader = (await cookies()).toString();
  return createApiCore({
    baseUrl: internalUrl(),
    extraHeaders: () => (cookieHeader ? { cookie: cookieHeader } : {}),
  });
}

/** Returns the signed-in user or redirects to /login. */
export async function requireSession(): Promise<MeResponse> {
  const api = await serverApi();
  const me = await api.getMe();
  if (!me) redirect(await loginPath());
  return me;
}

/** Loads page data. Redirects to login on 401 and calls notFound() on 404; other failures are returned. */
export async function loadPageData<S extends z.ZodType>(
  path: string,
  schema: S,
): Promise<{ data: z.infer<S>; error: null } | { data: null; error: unknown }> {
  try {
    return { data: await (await serverApi()).get(path, schema), error: null };
  } catch (e) {
    if (e instanceof SessionExpiredError) redirect(await loginPath());
    if (e instanceof ApiRequestError && (e.status === 404 || e.code === 'NOT_FOUND')) notFound();
    return { data: null, error: e };
  }
}

/** For pages: redirect to login when a data call finds the session expired, otherwise rethrow. */
export async function redirectIfExpired(error: unknown): Promise<never> {
  if (error instanceof SessionExpiredError) redirect(await loginPath());
  throw error;
}
