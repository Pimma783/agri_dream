import { z } from 'zod';
import { type Db, dec, exec, maybe, ts, uuid } from './db.js';
import { type Insertable, table } from './table.js';

const channel = z.enum(['farmer', 'baler', 'factory']);

// organizations ----------------------------------------------------------------------------------
export const OrganizationRow = z.object({
  id: uuid,
  kind: z.enum(['FARMER', 'BALER', 'BUYER_FACTORY']),
  name: z.string(),
  province: z.string().nullable(),
  district: z.string().nullable(),
  lat: dec.nullable(),
  lng: dec.nullable(),
  is_demo: z.boolean(),
  created_at: ts,
});
export type Organization = z.infer<typeof OrganizationRow>;
const orgs = table('organizations', OrganizationRow);
export const organizations = {
  insert: (db: Db, v: Insertable<Organization, 'kind' | 'name'>) => orgs.insert(db, v),
  get: orgs.get,
  update: (db: Db, id: string, patch: Partial<Pick<Organization, 'name' | 'province' | 'district' | 'lat' | 'lng'>>) =>
    orgs.update(db, id, patch),
  listByKind: (db: Db, kind: Organization['kind']) => orgs.where(db, { kind }, { orderBy: 'created_at' }),
};

// users ------------------------------------------------------------------------------------------
export const UserRow = z.object({
  id: uuid,
  email: z.string().nullable(),
  password_hash: z.string().nullable(),
  display_name: z.string(),
  consent_at: ts.nullable(),
  is_demo: z.boolean(),
  created_at: ts,
});
export type User = z.infer<typeof UserRow>;
const usersT = table('users', UserRow);
export const users = {
  insert: (db: Db, v: Insertable<User, 'display_name'>) => usersT.insert(db, v),
  get: usersT.get,
  /** citext column: the match is case-insensitive. */
  getByEmail: (db: Db, email: string) =>
    maybe(db, UserRow, 'SELECT * FROM users WHERE email = $1', [email]),
  setConsent: (db: Db, id: string, at: Date) => usersT.update(db, id, { consent_at: at }),
};

// memberships ------------------------------------------------------------------------------------
export const MembershipRow = z.object({
  user_id: uuid,
  org_id: uuid,
  member_role: z.enum(['OWNER', 'MEMBER']),
  created_at: ts,
});
export type Membership = z.infer<typeof MembershipRow>;
const mem = table('memberships', MembershipRow);
export const memberships = {
  insert: (db: Db, v: Insertable<Membership, 'user_id' | 'org_id'>) => mem.insert(db, v),
  get: (db: Db, userId: string, orgId: string) =>
    maybe(db, MembershipRow, 'SELECT * FROM memberships WHERE user_id = $1 AND org_id = $2', [userId, orgId]),
  listByUser: (db: Db, userId: string) => mem.where(db, { user_id: userId }, { orderBy: 'created_at' }),
  listByOrg: (db: Db, orgId: string) => mem.where(db, { org_id: orgId }, { orderBy: 'created_at' }),
};

// sessions (only the sha256 of the token is stored) -----------------------------------------------
export const SessionRow = z.object({
  token_hash: z.string(),
  user_id: uuid,
  active_org_id: uuid.nullable(),
  csrf_secret: z.string(),
  created_at: ts,
  expires_at: ts,
});
export type Session = z.infer<typeof SessionRow>;
const sess = table('sessions', SessionRow, { pk: 'token_hash' });
export const sessions = {
  insert: (db: Db, v: Insertable<Session, 'token_hash' | 'user_id' | 'csrf_secret' | 'expires_at'>) =>
    sess.insert(db, v),
  /** Returns the session only while it has not expired at `now`. */
  getValid: (db: Db, tokenHash: string, now: Date) =>
    maybe(db, SessionRow, 'SELECT * FROM sessions WHERE token_hash = $1 AND expires_at > $2', [tokenHash, now]),
  /** Slide the idle expiry forward. Never shortens it. */
  extend: (db: Db, tokenHash: string, expiresAt: Date) =>
    exec(db, 'UPDATE sessions SET expires_at = $2 WHERE token_hash = $1 AND expires_at < $2', [tokenHash, expiresAt]),
  setActiveOrg: (db: Db, tokenHash: string, orgId: string | null) =>
    sess.update(db, tokenHash, { active_org_id: orgId }),
  delete: (db: Db, tokenHash: string) => sess.deleteWhere(db, { token_hash: tokenHash }),
  deleteExpired: (db: Db, now: Date) => exec(db, 'DELETE FROM sessions WHERE expires_at <= $1', [now]),
};

// line_identities --------------------------------------------------------------------------------
export const LineIdentityRow = z.object({
  id: uuid,
  channel,
  line_provider_id: z.string().nullable(),
  line_user_id: z.string(),
  user_id: uuid.nullable(),
  org_id: uuid.nullable(),
  status: z.enum(['UNLINKED', 'LINKED']),
  created_at: ts,
});
export type LineIdentity = z.infer<typeof LineIdentityRow>;
const lid = table('line_identities', LineIdentityRow);
export const lineIdentities = {
  get: lid.get,
  getForUpdate: lid.getForUpdate,
  getByChannelUser: (db: Db, ch: LineIdentity['channel'], lineUserId: string) =>
    maybe(db, LineIdentityRow, 'SELECT * FROM line_identities WHERE channel = $1 AND line_user_id = $2', [ch, lineUserId]),
  /** Create an UNLINKED identity, or return the existing one for (channel, line_user_id). */
  async ensure(db: Db, ch: LineIdentity['channel'], lineUserId: string, providerId?: string): Promise<LineIdentity> {
    // Two statements on purpose. With ON CONFLICT DO NOTHING a concurrent insert of the same key
    // makes this statement wait for the other transaction, then skip. A SELECT in the same
    // statement (CTE) still uses the snapshot from before that commit and sees no row. A separate
    // SELECT takes a fresh READ COMMITTED snapshot and sees the committed row.
    await exec(
      db,
      `INSERT INTO line_identities (channel, line_user_id, line_provider_id, status)
       VALUES ($1, $2, $3, 'UNLINKED') ON CONFLICT (channel, line_user_id) DO NOTHING`,
      [ch, lineUserId, providerId ?? null],
    );
    const row = await maybe(
      db, LineIdentityRow, 'SELECT * FROM line_identities WHERE channel = $1 AND line_user_id = $2', [ch, lineUserId],
    );
    if (!row) throw new Error('line identity not found after ensure');
    return row;
  },
  link: (db: Db, id: string, userId: string, orgId: string) =>
    lid.update(db, id, { user_id: userId, org_id: orgId, status: 'LINKED' }),
  listByOrg: (db: Db, orgId: string) => lid.where(db, { org_id: orgId }, { orderBy: 'created_at' }),
};

// line_link_codes (only the hash is stored) --------------------------------------------------------
export const LinkCodeRow = z.object({
  code_hash: z.string(),
  org_id: uuid,
  user_id: uuid,
  channel,
  created_at: ts,
  expires_at: ts,
  used_at: ts.nullable(),
});
export type LinkCode = z.infer<typeof LinkCodeRow>;
const lc = table('line_link_codes', LinkCodeRow, { pk: 'code_hash' });
export const linkCodes = {
  insert: (db: Db, v: Insertable<LinkCode, 'code_hash' | 'org_id' | 'user_id' | 'channel' | 'expires_at'>) =>
    lc.insert(db, v),
  get: lc.get,
  /** Atomic single-use redemption: returns the row only for the one caller that wins. */
  redeem: (db: Db, codeHash: string, ch: LinkCode['channel'], now: Date) =>
    maybe(
      db,
      LinkCodeRow,
      `UPDATE line_link_codes SET used_at = $3
       WHERE code_hash = $1 AND channel = $2 AND used_at IS NULL AND expires_at > $3 RETURNING *`,
      [codeHash, ch, now],
    ),
};
