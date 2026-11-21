// Link codes and actor resolution against real Postgres (Requirements 1.5-1.7, 3.1-3.4). All data synthetic.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Actor } from '../src/domain/permissions.js';
import { exec, many, memberships, organizations } from '../src/repos/index.js';
import { sha256Hex } from '../src/services/auth/index.js';
import {
  createLineIdentityService, LINK_FAILURE_MESSAGE_TH, type LineChannel, type LineIdentityService,
} from '../src/services/identity/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeOrg, makeOrgWithUser, makeUser } from './factories.js';

const TTL = 10 * 60_000;
describe.skipIf(!testDatabaseUrl)('line identity (real Postgres)', () => {
  let db: TestDb;
  let clock = new Date('2030-01-01T00:00:00Z');
  let svc: LineIdentityService;
  let n = 0;
  const lu = () => `U-synthetic-${++n}`;
  beforeAll(async () => {
    db = await createTestDb();
    svc = createLineIdentityService({ pool: db.pool, config: { linkCodeTtlMs: TTL }, now: () => clock });
  });
  afterAll(async () => { await db?.close(); });

  const webActor = (userId: string, orgId: string, role: Actor['role']): Actor => ({ userId, orgId, role, channel: 'web' });
  async function issue(kind: 'FARMER' | 'BALER' | 'BUYER_FACTORY') {
    const { org, user } = await makeOrgWithUser(db.pool, kind);
    const r = await svc.issueLinkCode(webActor(user.id, org.id, kind));
    if (!r.ok) throw new Error('issue failed');
    return { org, user, code: r.value.code };
  }
  const redeem = (channel: LineChannel, code: string, lineUserId = lu()) => svc.redeemLinkCode({ channel, lineUserId, code });
  const FAIL = { ok: false, error: { code: 'LINK_CODE_INVALID', message_th: LINK_FAILURE_MESSAGE_TH } };
  const identityCount = async () =>
    (await many(db.pool, z.object({ n: z.coerce.number() }), 'SELECT count(*) AS n FROM line_identities'))[0]!.n;

  it('stores only the sha256 hash, with org, user, channel and expiry', async () => {
    const { org, user, code } = await issue('BALER');
    const rows = await many(db.pool, z.object({ code_hash: z.string(), org_id: z.string(), user_id: z.string(), channel: z.string(), ttl: z.coerce.number(), used_at: z.date().nullable() }),
      `SELECT code_hash, org_id, user_id, channel, extract(epoch FROM expires_at - created_at) * 1000 AS ttl, used_at FROM line_link_codes WHERE code_hash = $1`, [sha256Hex(code)]);
    expect(rows).toEqual([{ code_hash: sha256Hex(code), org_id: org.id, user_id: user.id, channel: 'baler', ttl: TTL, used_at: null }]);
    const raw = await many(db.pool, z.object({ n: z.coerce.number() }), `SELECT count(*) AS n FROM line_link_codes WHERE code_hash = $1`, [code]);
    expect(raw[0]!.n).toBe(0);
  });

  it('links the LINE identity and the code cannot be reused', async () => {
    const { org, user, code } = await issue('FARMER');
    const line = lu();
    const r = await redeem('farmer', code, line);
    expect(r).toEqual({ ok: true, value: { actor: { userId: user.id, orgId: org.id, role: 'FARMER', channel: 'line:farmer' }, organizationName: org.name } });
    expect(await svc.resolveLineActor('farmer', line)).toEqual((r as { value: { actor: Actor } }).value.actor);
    expect(await redeem('farmer', code)).toEqual(FAIL);
    expect(await redeem('farmer', code.toLowerCase(), line)).toEqual(FAIL);
  });

  it('gives the identical failure for unknown, wrong-channel, used and expired codes, changing nothing', async () => {
    const wrong = await issue('BUYER_FACTORY');
    const expired = await issue('BALER');
    const before = await identityCount();
    clock = new Date(clock.getTime() + TTL + 1);
    const fresh = await issue('BALER'); // issued after the move, so still valid
    const results = [
      await redeem('baler', 'ABCD2345'),
      await redeem('baler', 'not a code'),
      await redeem('baler', wrong.code), // factory code on the baler channel
      await redeem('baler', expired.code),
    ];
    for (const r of results) expect(r).toEqual(FAIL);
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(await identityCount()).toBe(before);
    const stillUnused = await many(db.pool, z.object({ used_at: z.date().nullable() }), 'SELECT used_at FROM line_link_codes WHERE code_hash = $1', [sha256Hex(wrong.code)]);
    expect(stillUnused[0]!.used_at).toBeNull(); // a wrong-channel attempt does not burn the code
    expect((await redeem('baler', fresh.code)).ok).toBe(true);
  });

  it('lets exactly one of many concurrent redemptions win', async () => {
    const { code } = await issue('BUYER_FACTORY');
    const results = await Promise.all(Array.from({ length: 8 }, () => redeem('factory', code)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(7);
  });

  it('refuses when the member left the organization, without burning the code', async () => {
    const { org, user, code } = await issue('BALER');
    await exec(db.pool, 'DELETE FROM memberships WHERE user_id = $1 AND org_id = $2', [user.id, org.id]);
    expect(await redeem('baler', code)).toEqual(FAIL);
    const row = await many(db.pool, z.object({ used_at: z.date().nullable() }), 'SELECT used_at FROM line_link_codes WHERE code_hash = $1', [sha256Hex(code)]);
    expect(row[0]!.used_at).toBeNull();
  });

  it('does not move a LINE account that is already linked', async () => {
    const a = await issue('BALER');
    const b = await issue('BALER');
    const line = lu();
    expect((await redeem('baler', a.code, line)).ok).toBe(true);
    expect(await redeem('baler', b.code, line)).toEqual(FAIL);
    expect((await svc.resolveLineActor('baler', line))?.orgId).toBe(a.org.id);
  });

  it('only a current member on a web session can issue a code; knowing org name or email grants nothing', async () => {
    const org = await makeOrg(db.pool, 'BALER');
    const outsider = await makeUser(db.pool);
    expect(await svc.issueLinkCode(webActor(outsider.id, org.id, 'BALER'))).toEqual(FAIL);
    const { user } = await makeOrgWithUser(db.pool, 'FARMER');
    expect(await svc.issueLinkCode(webActor(user.id, org.id, 'BALER'))).toEqual(FAIL); // not a member of that org
    const { org: o2, user: u2 } = await makeOrgWithUser(db.pool, 'FARMER');
    expect(await svc.issueLinkCode(webActor(u2.id, o2.id, 'BALER'))).toEqual(FAIL); // role claim contradicts the stored org
    expect(await svc.issueLinkCode({ ...webActor(u2.id, o2.id, 'FARMER'), channel: 'line:farmer' })).toEqual(FAIL);
    // sending an org name or email in LINE is just text: no identity is linked
    const line = lu();
    expect(await redeem('baler', `${org.name}`, line)).toEqual(FAIL);
    expect(await redeem('baler', outsider.email ?? 'x', line)).toEqual(FAIL);
    expect(await svc.resolveLineActor('baler', line)).toBeNull();
  });

  it('farmer follow creates one personal FARMER organization; double follow does not duplicate it', async () => {
    const line = lu();
    const [x, y] = await Promise.all([1, 2].map(() => svc.handleFollow({ channel: 'farmer', lineUserId: line })));
    expect([x!.createdOrganization, y!.createdOrganization].filter(Boolean)).toHaveLength(1);
    expect(x!.actor).toEqual(y!.actor);
    const actor = (await svc.resolveLineActor('farmer', line))!;
    expect(actor.role).toBe('FARMER');
    expect(actor.channel).toBe('line:farmer');
    expect((await organizations.get(db.pool, actor.orgId))?.kind).toBe('FARMER');
    expect((await memberships.get(db.pool, actor.userId, actor.orgId))?.member_role).toBe('OWNER');
    const again = await svc.handleFollow({ channel: 'farmer', lineUserId: line });
    expect(again.createdOrganization).toBe(false);
  });

  it('baler and factory follow create an UNLINKED identity with no actor and no organization', async () => {
    const orgsBefore = (await many(db.pool, z.object({ n: z.coerce.number() }), 'SELECT count(*) AS n FROM organizations'))[0]!.n;
    for (const ch of ['baler', 'factory'] as const) {
      const line = lu();
      const out = await svc.handleFollow({ channel: ch, lineUserId: line });
      expect(out.identity.status).toBe('UNLINKED');
      expect(out.actor).toBeNull();
      expect(out.createdOrganization).toBe(false);
      expect(await svc.resolveLineActor(ch, line)).toBeNull();
    }
    const orgsAfter = (await many(db.pool, z.object({ n: z.coerce.number() }), 'SELECT count(*) AS n FROM organizations'))[0]!.n;
    expect(orgsAfter).toBe(orgsBefore);
  });

  it('the same LINE user id on another channel is a different identity', async () => {
    const { code } = await issue('BALER');
    const line = lu();
    expect((await redeem('baler', code, line)).ok).toBe(true);
    expect(await svc.resolveLineActor('factory', line)).toBeNull();
    expect(await svc.resolveLineActor('farmer', line)).toBeNull();
  });

  it('drops the actor when the membership is removed later', async () => {
    const { org, user, code } = await issue('BALER');
    const line = lu();
    await redeem('baler', code, line);
    await exec(db.pool, 'DELETE FROM memberships WHERE user_id = $1 AND org_id = $2', [user.id, org.id]);
    expect(await svc.resolveLineActor('baler', line)).toBeNull();
  });
});
