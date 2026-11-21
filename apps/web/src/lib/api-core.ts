import { apiErrorSchema, apiMeSchema, type ErrorCode, type MeResponse } from '@agrimatch/contracts';
import type { z } from 'zod';

/** Typed API failure. `code` is a contract error code or a transport-level fallback. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK' | 'BAD_RESPONSE',
    readonly messageTh: string,
    /** VALIDATION only: paths of the invalid fields. */
    readonly fieldPaths: readonly string[] = [],
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiRequestError';
  }
}

/** Thrown on HTTP 401. Callers redirect to /login. */
export class SessionExpiredError extends ApiRequestError {
  constructor() {
    super(401, 'UNAUTHENTICATED', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
    this.name = 'SessionExpiredError';
  }
}

export const LOGIN_EXPIRED_PATH = '/login?expired=1';

export interface ApiCoreOptions {
  /** '/api' in the browser; the API internal URL on the server. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Extra headers per request (the server adds the forwarded Cookie). */
  extraHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  /** Browser only: sends the session cookie. The server forwards it by header instead. */
  credentials?: RequestCredentials;
}

export interface RequestOptions<S extends z.ZodType> {
  schema: S;
  body?: unknown;
  headers?: Record<string, string>;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const NETWORK_MESSAGE = 'เชื่อมต่อไม่ได้ กรุณาลองใหม่';
const BAD_RESPONSE_MESSAGE = 'ข้อมูลที่ได้รับไม่ถูกต้อง กรุณาลองใหม่';

export function createApiCore(opts: ApiCoreOptions) {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let csrfSecret: string | null = null;

  async function send(method: string, path: string, body: unknown, headers: Record<string, string>): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.extraHeaders ? await opts.extraHeaders() : {}),
        ...headers,
      },
      cache: 'no-store',
    };
    if (opts.credentials) init.credentials = opts.credentials;
    if (body !== undefined) init.body = JSON.stringify(body);
    try {
      return await doFetch(`${opts.baseUrl}${path}`, init);
    } catch {
      throw new ApiRequestError(0, 'NETWORK', NETWORK_MESSAGE);
    }
  }

  async function readJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (text === '') return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  function toError(res: Response, json: unknown): ApiRequestError {
    if (res.status === 401) return new SessionExpiredError();
    const parsed = apiErrorSchema.safeParse(json);
    if (parsed.success) return new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message_th, (parsed.data.error.fields ?? []).map((f) => f.path));
    return new ApiRequestError(res.status, res.status >= 500 ? 'INTERNAL' : 'BAD_RESPONSE', BAD_RESPONSE_MESSAGE);
  }

  /** Reads csrf_secret from GET /me (cached per client; cleared on 401 or CSRF failure). */
  async function getCsrfSecret(force = false): Promise<string> {
    if (csrfSecret !== null && !force) return csrfSecret;
    const me = await getMeStrict();
    return me.csrf_secret;
  }

  async function getMeStrict(): Promise<MeResponse> {
    const res = await send('GET', '/me', undefined, {});
    const json = await readJson(res);
    if (!res.ok) throw toError(res, json);
    const parsed = apiMeSchema.safeParse(json);
    // A session without an organization or role cannot use the dashboard.
    if (!parsed.success || !parsed.data.org || !parsed.data.role) {
      throw new ApiRequestError(res.status, 'BAD_RESPONSE', BAD_RESPONSE_MESSAGE);
    }
    const { user, org, role, csrf_secret } = parsed.data;
    csrfSecret = csrf_secret;
    return { user_id: user.id, org_id: org.id, org_name: org.name, role: role === 'BUYER_FACTORY' ? 'FACTORY' : role, csrf_secret };
  }

  async function request<S extends z.ZodType>(
    method: string,
    path: string,
    o: RequestOptions<S>,
  ): Promise<z.infer<S>> {
    const m = method.toUpperCase();
    const unsafe = !SAFE_METHODS.has(m);
    // The browser adds the same-origin Origin header on fetch(); the API checks it against WEB_ORIGIN.
    for (let attempt = 0; ; attempt++) {
      const headers = { ...(o.headers ?? {}) };
      if (unsafe) headers['x-csrf-token'] = await getCsrfSecret(attempt > 0);
      const res = await send(m, path, o.body, headers);
      const json = await readJson(res);
      if (res.status === 401) {
        csrfSecret = null;
        throw new SessionExpiredError();
      }
      if (!res.ok) {
        const err = toError(res, json);
        // A stale CSRF secret (e.g. session rotated) gets one retry with a fresh one.
        if (unsafe && err.code === 'CSRF' && attempt === 0) {
          csrfSecret = null;
          continue;
        }
        throw err;
      }
      const parsed = o.schema.safeParse(json);
      if (!parsed.success) throw new ApiRequestError(res.status, 'BAD_RESPONSE', BAD_RESPONSE_MESSAGE);
      return parsed.data;
    }
  }

  return {
    get: <S extends z.ZodType>(path: string, schema: S) => request('GET', path, { schema }),
    post: <S extends z.ZodType>(path: string, schema: S, body?: unknown, headers?: Record<string, string>) =>
      request('POST', path, { schema, body, ...(headers ? { headers } : {}) }),
    put: <S extends z.ZodType>(path: string, schema: S, body?: unknown) => request('PUT', path, { schema, body }),
    patch: <S extends z.ZodType>(path: string, schema: S, body?: unknown) => request('PATCH', path, { schema, body }),
    delete: <S extends z.ZodType>(path: string, schema: S) => request('DELETE', path, { schema }),
    request,
    /** Returns null when not signed in. */
    async getMe(): Promise<MeResponse | null> {
      try {
        return await getMeStrict();
      } catch (e) {
        if (e instanceof SessionExpiredError) return null;
        throw e;
      }
    },
    getCsrfSecret,
  };
}

export type ApiCore = ReturnType<typeof createApiCore>;
