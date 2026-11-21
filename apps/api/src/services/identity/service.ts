// LINE link codes and actor resolution (Requirements 1.5-1.7, 3.1-3.4). Layer: services.
// An Actor is built only here (LINE channel + verified line_identities row) or from a session in
// services/auth. Nothing a client sends (name, email, role, org id) is ever used to pick an actor.
import { randomInt } from 'node:crypto';
import type pg from 'pg';
import type { Actor, Channel, Role } from '../../domain/permissions.js';
import {
  lineIdentities, linkCodes, memberships, organizations, users, withTransaction,
  type LineIdentity,
} from '../../repos/index.js';
import { sha256Hex } from '../auth/service.js';

export type LineChannel = 'farmer' | 'baler' | 'factory';
export const LINE_CHANNELS: readonly LineChannel[] = ['farmer', 'baler', 'factory'];

/** 31 characters: no 0/O, 1/I/L (easy to misread when typed from a screen into LINE). */
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LINK_CODE_LENGTH = 8;
const CODE_RE = new RegExp(`^[${LINK_CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`);

/** One message for unknown, expired, used, wrong-channel and any other refusal (Requirement 3.3). */
export const LINK_FAILURE_MESSAGE_TH = 'รหัสผูกบัญชีไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสใหม่จากหน้าเว็บ';
export interface LinkFailure {
  code: 'LINK_CODE_INVALID';
  message_th: string;
}
export type LinkResult<T> = { ok: true; value: T } | { ok: false; error: LinkFailure };
const FAILURE = { ok: false, error: { code: 'LINK_CODE_INVALID', message_th: LINK_FAILURE_MESSAGE_TH } } as const;

const ROLE_CHANNEL: Record<Role, LineChannel> = { FARMER: 'farmer', BALER: 'baler', BUYER_FACTORY: 'factory' };
const CHANNEL_ROLE: Record<LineChannel, Role> = { farmer: 'FARMER', baler: 'BALER', factory: 'BUYER_FACTORY' };
export const lineChannelOf = (role: Role): LineChannel => ROLE_CHANNEL[role];
export const roleOfLineChannel = (channel: LineChannel): Role => CHANNEL_ROLE[channel];
const actorChannel = (c: LineChannel): Channel => `line:${c}`;

export function generateLinkCode(): string {
  let out = '';
  for (let i = 0; i < LINK_CODE_LENGTH; i++) out += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  return out;
}

/** Trim, upper-case and drop spaces and hyphens, so "abcd-2345" and "ABCD 2345" both work. */
export function normalizeLinkCode(raw: string): string | null {
  const code = raw.normalize('NFKC').replace(/[\s-]/g, '').toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export interface IssuedLinkCode {
  /** Shown once to the member. Only its sha256 is stored. */
  code: string;
  expiresAt: Date;
}
export interface LineLinkStatus {
  channel: LineChannel;
  linked: boolean;
}
export interface FollowOutcome {
  identity: LineIdentity;
  /** Null for an UNLINKED identity: no organization rights until a link code is redeemed. */
  actor: Actor | null;
  /** True when this call created a personal FARMER organization. */
  createdOrganization: boolean;
}
export interface LineIdentityService {
  /** The caller must be a session actor (web) who is a current member of `actor.orgId`. Bound to that org and role. */
  issueLinkCode(actor: Actor): Promise<LinkResult<IssuedLinkCode>>;
  redeemLinkCode(input: { channel: LineChannel; lineUserId: string; code: string; providerId?: string }): Promise<LinkResult<{ actor: Actor; organizationName: string }>>;
  /**
   * LINE link status for the signed-in member, for the one channel that belongs to the actor's role.
   * Reads only the member's own rows; never returns LINE user IDs.
   */
  lineLinkStatus(actor: Actor): Promise<LineLinkStatus[]>;
  /** Actor for a verified LINE user on a channel, or null (unknown, UNLINKED, membership gone, role mismatch). */
  resolveLineActor(channel: LineChannel, lineUserId: string): Promise<Actor | null>;
  /** Follow event. Farmers get a personal FARMER organization (A7); balers and factories only an UNLINKED identity. */
  handleFollow(input: { channel: LineChannel; lineUserId: string; providerId?: string }): Promise<FollowOutcome>;
}
export interface LineIdentityDeps {
  pool: pg.Pool;
  config: { linkCodeTtlMs: number };
  now?: () => Date;
}

class Refuse extends Error {}

export function createLineIdentityService({ pool, config, now = () => new Date() }: LineIdentityDeps): LineIdentityService {
  /** Builds the actor from a LINKED row after re-checking the org kind, channel and current membership. */
  async function actorFor(db: pg.Pool | pg.PoolClient, identity: LineIdentity): Promise<Actor | null> {
    if (identity.status !== 'LINKED' || !identity.user_id || !identity.org_id) return null;
    const org = await organizations.get(db, identity.org_id);
    if (!org || org.kind !== CHANNEL_ROLE[identity.channel]) return null;
    if (!(await memberships.get(db, identity.user_id, org.id))) return null;
    return { userId: identity.user_id, orgId: org.id, role: org.kind, channel: actorChannel(identity.channel) };
  }

  return {
    async issueLinkCode(actor) {
      if (actor.channel !== 'web') return FAILURE;
      const member = await memberships.get(pool, actor.userId, actor.orgId);
      const org = member ? await organizations.get(pool, actor.orgId) : null;
      // The role comes from the stored organization, never from the actor's own claim.
      if (!member || !org || org.kind !== actor.role) return FAILURE;
      const expiresAt = new Date(now().getTime() + config.linkCodeTtlMs);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateLinkCode();
        try {
          await linkCodes.insert(pool, {
            code_hash: sha256Hex(code), org_id: org.id, user_id: actor.userId,
            channel: ROLE_CHANNEL[org.kind], created_at: now(), expires_at: expiresAt,
          });
          return { ok: true, value: { code, expiresAt } };
        } catch (err) {
          if ((err as { code?: string }).code !== '23505') throw err; // hash collision: draw again
        }
      }
      throw new Error('could not allocate a unique link code');
    },

    async redeemLinkCode({ channel, lineUserId, code, providerId }) {
      const normalized = normalizeLinkCode(code);
      if (!normalized || !LINE_CHANNELS.includes(channel) || lineUserId === '') return FAILURE;
      try {
        return await withTransaction(pool, async (tx) => {
          // One UPDATE decides: unknown, used, expired and wrong channel all return no row.
          const row = await linkCodes.redeem(tx, sha256Hex(normalized), channel, now());
          if (!row) throw new Refuse();
          const org = await organizations.get(tx, row.org_id);
          if (!org || org.kind !== CHANNEL_ROLE[channel] || !(await memberships.get(tx, row.user_id, row.org_id))) {
            throw new Refuse(); // rolls the redemption back: the code is not burned by an impossible link
          }
          const ensured = await lineIdentities.ensure(tx, channel, lineUserId, providerId);
          const identity = await lineIdentities.getForUpdate(tx, ensured.id);
          if (!identity || identity.status === 'LINKED') throw new Refuse(); // never silently move a linked LINE account
          await lineIdentities.link(tx, identity.id, row.user_id, row.org_id);
          return { ok: true as const, value: { actor: { userId: row.user_id, orgId: org.id, role: org.kind, channel: actorChannel(channel) }, organizationName: org.name } };
        });
      } catch (err) {
        if (err instanceof Refuse) return FAILURE;
        throw err;
      }
    },

    async lineLinkStatus(actor) {
      if (actor.channel !== 'web') return [];
      const channel = ROLE_CHANNEL[actor.role];
      const rows = await lineIdentities.listByOrg(pool, actor.orgId);
      const linked = rows.some((r) => r.channel === channel && r.status === 'LINKED' && r.user_id === actor.userId);
      return [{ channel, linked }];
    },

    async resolveLineActor(channel, lineUserId) {
      const identity = await lineIdentities.getByChannelUser(pool, channel, lineUserId);
      return identity ? actorFor(pool, identity) : null;
    },

    async handleFollow({ channel, lineUserId, providerId }) {
      return withTransaction(pool, async (tx) => {
        const ensured = await lineIdentities.ensure(tx, channel, lineUserId, providerId);
        let identity = (await lineIdentities.getForUpdate(tx, ensured.id)) ?? ensured; // row lock serializes double follows
        let createdOrganization = false;
        if (channel === 'farmer' && identity.status === 'UNLINKED') {
          const org = await organizations.insert(tx, { kind: 'FARMER', name: 'เกษตรกร (LINE)', is_demo: false });
          const user = await users.insert(tx, { display_name: 'เกษตรกร LINE', is_demo: false });
          await memberships.insert(tx, { user_id: user.id, org_id: org.id, member_role: 'OWNER' });
          identity = (await lineIdentities.link(tx, identity.id, user.id, org.id)) ?? identity;
          createdOrganization = true;
        }
        return { identity, actor: await actorFor(tx, identity), createdOrganization };
      });
    },
  };
}
