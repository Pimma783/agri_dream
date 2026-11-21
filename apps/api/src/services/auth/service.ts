// Auth service (Requirement 3.5-3.7). Layer: services. Opens its own transactions; routes only call this.
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { memberships, organizations, sessions, users, withTransaction } from '../../repos/index.js';
import type { Actor, Role } from '../../domain/permissions.js';
import { hashPassword, verifyPassword } from './password.js';
import { LoginRateLimiter } from './rate-limit.js';

export type AuthErrorCode = 'INVALID_CREDENTIALS' | 'RATE_LIMITED';
export type AuthResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: AuthErrorCode; status: 401 | 429; retryAfterSeconds?: number } };

export interface AuthConfig {
  idleMs: number;
  absoluteMs: number;
}
export interface AuthSession {
  user: { id: string; email: string | null; displayName: string };
  org: { id: string; kind: Role; name: string } | null;
  /** Null when the user has no organization yet: no actor can be built. */
  actor: Actor | null;
  csrfSecret: string;
  expiresAt: Date;
  /** True when this call slid the idle expiry forward (the cookie should be re-issued). */
  extended: boolean;
}
export interface LoginOutcome {
  token: string;
  expiresAt: Date;
}
export interface AuthService {
  login(input: { email: string; password: string; ip: string }): Promise<AuthResult<LoginOutcome>>;
  logout(token: string): Promise<void>;
  resolveSession(token: string): Promise<AuthSession | null>;
}
export interface AuthDeps {
  pool: pg.Pool;
  config: AuthConfig;
  limiter: LoginRateLimiter;
  now?: () => Date;
}

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');
/** 256 random bits as base64url (43 characters). */
export const newToken = (): string => randomBytes(32).toString('base64url');

export function createAuthService({ pool, config, limiter, now = () => new Date() }: AuthDeps): AuthService {
  return {
    async login({ email, password, ip }) {
      const key = LoginRateLimiter.key(ip, email);
      const t = now();
      const wait = limiter.retryAfterSeconds(key, t.getTime());
      if (wait > 0) return { ok: false, error: { code: 'RATE_LIMITED', status: 429, retryAfterSeconds: wait } };
      const user = await users.getByEmail(pool, email.trim());
      // Verifies a dummy hash when the user or password is missing, so timing does not reveal existence.
      const valid = await verifyPassword(user?.password_hash, password);
      if (!user || !valid) {
        limiter.recordFailure(key, now().getTime());
        return { ok: false, error: { code: 'INVALID_CREDENTIALS', status: 401 } };
      }
      limiter.reset(key);
      const token = newToken();
      const issued = now();
      const expiresAt = new Date(issued.getTime() + config.idleMs);
      await withTransaction(pool, async (tx) => {
        const first = (await memberships.listByUser(tx, user.id))[0];
        await sessions.insert(tx, {
          token_hash: sha256Hex(token),
          user_id: user.id,
          active_org_id: first?.org_id ?? null,
          csrf_secret: newToken(),
          created_at: issued,
          expires_at: expiresAt,
        });
      });
      return { ok: true, value: { token, expiresAt } };
    },

    async logout(token) {
      await sessions.delete(pool, sha256Hex(token));
    },

    async resolveSession(token) {
      const hash = sha256Hex(token);
      const t = now();
      const session = await sessions.getValid(pool, hash, t);
      if (!session) return null;
      // Absolute limit counts from creation and is never extended.
      const absoluteEnd = new Date(session.created_at.getTime() + config.absoluteMs);
      if (t >= absoluteEnd) {
        await sessions.delete(pool, hash);
        return null;
      }
      const user = await users.get(pool, session.user_id);
      if (!user) return null;
      const org = session.active_org_id ? await organizations.get(pool, session.active_org_id) : null;
      // The membership is re-checked on every request, so removing a member takes effect at once.
      const member = org ? await memberships.get(pool, user.id, org.id) : null;
      let expiresAt = session.expires_at;
      let extended = false;
      const slid = new Date(Math.min(t.getTime() + config.idleMs, absoluteEnd.getTime()));
      // Write at most once per tenth of the idle window.
      if (slid.getTime() - expiresAt.getTime() > config.idleMs / 10) {
        await sessions.extend(pool, hash, slid);
        expiresAt = slid;
        extended = true;
      }
      const validOrg = org && member ? org : null;
      return {
        user: { id: user.id, email: user.email, displayName: user.display_name },
        org: validOrg ? { id: validOrg.id, kind: validOrg.kind, name: validOrg.name } : null,
        actor: validOrg ? { userId: user.id, orgId: validOrg.id, role: validOrg.kind, channel: 'web' } : null,
        csrfSecret: session.csrf_secret,
        expiresAt,
        extended,
      };
    },
  };
}

export interface DemoOrgUserInput {
  kind: Role;
  orgName: string;
  email: string;
  /** Supplied by the caller; the helper has no default so no password is ever hard-coded here. */
  password: string;
  displayName?: string;
  province?: string;
  lat?: string;
  lng?: string;
}
/** Create a demo organization with one OWNER user who can log in. Everything is flagged `is_demo`. */
export async function createDemoOrgUser(pool: pg.Pool, input: DemoOrgUserInput) {
  const passwordHash = await hashPassword(input.password);
  return withTransaction(pool, async (tx) => {
    const org = await organizations.insert(tx, {
      kind: input.kind,
      name: input.orgName,
      province: input.province ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      is_demo: true,
    });
    const user = await users.insert(tx, {
      email: input.email,
      password_hash: passwordHash,
      display_name: input.displayName ?? input.orgName,
      is_demo: true,
    });
    await memberships.insert(tx, { user_id: user.id, org_id: org.id, member_role: 'OWNER' });
    return { org, user };
  });
}
