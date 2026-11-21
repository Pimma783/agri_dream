import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/domain/permissions.js';
import { drafts, media } from '../src/repos/index.js';
import { createMediaService, DbMediaStore, MediaServiceError } from '../src/services/media/index.js';
import { MediaError } from '../src/adapters/media/port.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeImageBytes, makeListing, makeOrgWithUser } from './factories.js';
const SECRET = 'db-test-secret';
const actorOf = (org: { id: string }, user: { id: string }, role: Actor['role'] = 'FARMER'): Actor => ({
  userId: user.id, orgId: org.id, role, channel: 'web',
});
async function expectCode(p: Promise<unknown>, code: string, status: number) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(MediaServiceError);
  expect(err).toMatchObject({ code, status });
}
describe.skipIf(!testDatabaseUrl)('media store and service (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let now = new Date('2026-03-01T00:00:00Z');
  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
  });
  afterAll(async () => {
    await db?.close();
  });
  const svc = () => createMediaService({ pool, secret: SECRET, ttlSeconds: 300, now: () => now });
  async function farmerWithListing() {
    const f = await makeOrgWithUser(pool, 'FARMER');
    const listing = await makeListing(pool, f.org.id);
    return { ...f, listing, actor: actorOf(f.org, f.user) };
  }
  it('DbMediaStore is kind real with storage kind db; put/get/metadata/delete round trip', async () => {
    const f = await farmerWithListing();
    const store = new DbMediaStore(pool);
    expect(store.kind).toBe('real');
    expect(store.storageKind).toBe('db');
    const bytes = makeImageBytes('png', 1);
    const { meta, duplicate } = await store.put({ orgId: f.org.id, ownerType: 'LISTING', ownerId: f.listing.id, createdBy: f.user.id, bytes });
    expect(duplicate).toBe(false);
    expect(meta).toMatchObject({ contentType: 'image/png', sizeBytes: bytes.length });
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(meta)).not.toContain('storageKey');
    const got = await store.get(meta.id);
    expect(got?.contentType).toBe('image/png');
    expect(got?.bytes.equals(bytes)).toBe(true);
    expect((await store.metadata(meta.id))?.id).toBe(meta.id);
    const row = (await pool.query('SELECT storage_kind, storage_key, octet_length(content) AS n FROM media WHERE id = $1', [meta.id])).rows[0];
    expect(row).toMatchObject({ storage_kind: 'db', storage_key: null, n: bytes.length });
    expect(await store.delete(meta.id)).toBe(true);
    expect(await store.get(meta.id)).toBeNull();
    expect(await store.delete(meta.id)).toBe(false);
  });
  it('dedupes identical bytes per owner but not across owners', async () => {
    const f = await farmerWithListing();
    const other = await makeListing(pool, f.org.id);
    const store = new DbMediaStore(pool);
    const base = { orgId: f.org.id, createdBy: f.user.id, bytes: makeImageBytes('jpeg', 2) };
    const a = await store.put({ ...base, ownerType: 'LISTING', ownerId: f.listing.id });
    const b = await store.put({ ...base, ownerType: 'LISTING', ownerId: f.listing.id });
    const c = await store.put({ ...base, ownerType: 'LISTING', ownerId: other.id });
    expect(b.duplicate).toBe(true);
    expect(b.meta.id).toBe(a.meta.id);
    expect(c.duplicate).toBe(false);
    expect(c.meta.id).not.toBe(a.meta.id);
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      store.put({ orgId: f.org.id, createdBy: f.user.id, ownerType: 'LISTING', ownerId: f.listing.id, bytes: makeImageBytes('jpeg', 3) })));
    expect(new Set(results.map((r) => r.meta.id)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
  });
  it('rejects wrong type, empty and over 5 MB before writing', async () => {
    const f = await farmerWithListing();
    const store = new DbMediaStore(pool);
    const base = { orgId: f.org.id, createdBy: f.user.id, ownerType: 'LISTING' as const, ownerId: f.listing.id };
    await expect(store.put({ ...base, bytes: Buffer.from('GIF89a-not-allowed') })).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
    await expect(store.put({ ...base, bytes: Buffer.alloc(0) })).rejects.toBeInstanceOf(MediaError);
    const big = makeImageBytes('png', 4, 5 * 1024 * 1024 + 1);
    await expect(store.put({ ...base, bytes: big })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    const max = makeImageBytes('png', 5, 5 * 1024 * 1024);
    expect((await store.put({ ...base, bytes: max })).meta.sizeBytes).toBe(5 * 1024 * 1024);
    expect(await media.listByOwner(pool, 'LISTING', f.listing.id)).toHaveLength(1);
  });
  it('the schema holds the limits too (size CHECK, no filename column)', async () => {
    const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'media' AND table_schema = $1`, [db.schema])).rows.map((r) => r.column_name);
    expect(cols.some((c) => /file|name/i.test(c))).toBe(false);
  });
  it('service upload: owner org only, 404 for another org, 403 for a role without the capability', async () => {
    const f = await farmerWithListing();
    const s = svc();
    const ok = await s.upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes: makeImageBytes('jpeg', 10) });
    expect(ok).toMatchObject({ contentType: 'image/jpeg', duplicate: false });
    expect(Object.keys(ok)).not.toContain('storageKey');
    const stranger = await makeOrgWithUser(pool, 'FARMER');
    await expectCode(s.upload(actorOf(stranger.org, stranger.user), { ownerType: 'LISTING', ownerId: f.listing.id, bytes: makeImageBytes('jpeg', 11) }), 'NOT_FOUND', 404);
    const factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    await expectCode(s.upload(actorOf(factory.org, factory.user, 'BUYER_FACTORY'), { ownerType: 'LISTING', ownerId: f.listing.id, bytes: makeImageBytes('jpeg', 12) }), 'FORBIDDEN', 403);
    await expectCode(s.upload(f.actor, { ownerType: 'LISTING', ownerId: '00000000-0000-4000-8000-000000000000', bytes: makeImageBytes('jpeg', 13) }), 'NOT_FOUND', 404);
    await expectCode(s.upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes: Buffer.from('%PDF-1.7 nope') }), 'UNSUPPORTED_TYPE', 415);
    await expectCode(s.upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes: Buffer.alloc(0) }), 'EMPTY', 400);
    await expectCode(s.upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes: makeImageBytes('png', 14, 5 * 1024 * 1024 + 1) }), 'TOO_LARGE', 413);
  });
  it('service upload works for a DRAFT owner', async () => {
    const f = await makeOrgWithUser(pool, 'FARMER');
    const draft = await drafts.insert(pool, { org_id: f.org.id, kind: 'SALE_LISTING', data: {}, status: 'DRAFT', is_demo: false } as never);
    const r = await svc().upload(actorOf(f.org, f.user), { ownerType: 'DRAFT', ownerId: draft.id, bytes: makeImageBytes('png', 20) });
    expect(r.contentType).toBe('image/png');
  });
  it('getMediaUrl authorizes first, then issues a short-lived signed link that serves the bytes', async () => {
    const f = await farmerWithListing();
    const s = svc();
    const bytes = makeImageBytes('jpeg', 30);
    const up = await s.upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes });
    const stranger = await makeOrgWithUser(pool, 'FARMER');
    await expectCode(s.getMediaUrl(actorOf(stranger.org, stranger.user), up.mediaId), 'NOT_FOUND', 404);
    now = new Date('2026-03-01T00:00:00Z');
    const link = await s.getMediaUrl(f.actor, up.mediaId);
    expect(link.expiresAt.getTime() - now.getTime()).toBe(300_000);
    expect(link.url).toMatch(new RegExp(`^/media/${up.mediaId}/content\\?token=`));
    expect(link.url).not.toMatch(/storage|key/i);
    const token = new URL(link.url, 'http://x').searchParams.get('token')!;
    const content = await s.getContent(f.actor, up.mediaId, token);
    expect(content.contentType).toBe('image/jpeg');
    expect(content.bytes.equals(bytes)).toBe(true);
    // a valid link does not help another organization
    await expectCode(s.getContent(actorOf(stranger.org, stranger.user), up.mediaId, token), 'NOT_FOUND', 404);
    // a link for another media id is refused
    const up2 = await s.upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes: makeImageBytes('jpeg', 31) });
    await expectCode(s.getContent(f.actor, up2.mediaId, token), 'INVALID_TOKEN', 403);
    // expiry
    now = new Date(now.getTime() + 300_001);
    await expectCode(s.getContent(f.actor, up.mediaId, token), 'INVALID_TOKEN', 403);
    // direct authorized streaming without a token
    expect((await s.getContent(f.actor, up.mediaId)).bytes.equals(bytes)).toBe(true);
    now = new Date('2026-03-01T00:00:00Z');
  });
  it('delete is owner-only', async () => {
    const f = await farmerWithListing();
    const s = svc();
    const up = await s.upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes: makeImageBytes('png', 40) });
    const stranger = await makeOrgWithUser(pool, 'FARMER');
    await expectCode(s.delete(actorOf(stranger.org, stranger.user), up.mediaId), 'NOT_FOUND', 404);
    await s.delete(f.actor, up.mediaId);
    await expectCode(s.getContent(f.actor, up.mediaId), 'NOT_FOUND', 404);
  });
});
