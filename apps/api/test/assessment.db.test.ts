import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockBedrock } from '../src/adapters/bedrock/test-support.js';
import { createImageAssessor } from '../src/assistant/image-assessor.js';
import { EnvSchema } from '../src/config/env.js';
import { ASSESSMENT_DISCLAIMER_TH } from '../src/domain/assessment.js';
import type { Actor } from '../src/domain/permissions.js';
import { createApp } from '../src/http/app.js';
import { mediaRoutes } from '../src/http/media-routes.js';
import { HandlerRegistry, JobRunner, registerAssessImage } from '../src/jobs/index.js';
import { createLogger } from '../src/logger.js';
import { imageAssessments } from '../src/repos/index.js';
import { createAssessmentService } from '../src/services/assessment/index.js';
import { MediaServiceError } from '../src/services/media/index.js';
import { createJobQueue } from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeImageBytes, makeListing, makeOrgWithUser } from './factories.js';
const good = {
  likely_material: 'RICE_STRAW', color: 'เหลืองทอง', surface_condition: 'แห้ง', visible_contaminants: [], limitations: [], follow_up_questions: [],
};
const actorOf = (org: { id: string }, user: { id: string }): Actor => ({ userId: user.id, orgId: org.id, role: 'FARMER', channel: 'web' });
describe.skipIf(!testDatabaseUrl)('image upload and assessment (real Postgres, MockBedrock)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
  });
  afterAll(async () => {
    await db?.close();
  });
  const queue = () => createJobQueue(pool);
  const svc = () => createAssessmentService({ pool, queue: queue(), secret: 's', ttlSeconds: 300 });
  async function farmer() {
    const f = await makeOrgWithUser(pool, 'FARMER');
    const listing = await makeListing(pool, f.org.id);
    return { ...f, listing, actor: actorOf(f.org, f.user) };
  }
  const jobFor = async (mediaId: string) =>
    (await pool.query('SELECT status, kind, payload FROM jobs WHERE dedupe_key = $1', [mediaId])).rows;
  const assessorOf = (steps: ConstructorParameters<typeof MockBedrock>[0], enabled = true) =>
    createImageAssessor({ bedrock: new MockBedrock(steps), modelId: 'mock-vision', enabled });
  async function uploaded(n = 1) {
    const f = await farmer();
    const r = await svc().upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes: makeImageBytes('jpeg', n) });
    return { ...f, mediaId: r.mediaId };
  }
  it('upload stores the image and queues exactly one assess_image job, even for a duplicate upload', async () => {
    const f = await farmer();
    const bytes = makeImageBytes('png', 7);
    const a = await svc().upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes });
    const b = await svc().upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes });
    expect(b.mediaId).toBe(a.mediaId);
    expect(b.duplicate).toBe(true);
    const jobs = await jobFor(a.mediaId);
    expect(jobs).toEqual([{ status: 'QUEUED', kind: 'assess_image', payload: { media_id: a.mediaId } }]);
  });
  it('rejects a non-owner, bad bytes and oversize without storing or queueing', async () => {
    const f = await farmer();
    const other = await farmer();
    const before = (await pool.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n;
    const err = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);
    expect(await err(svc().upload(other.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes: makeImageBytes('png', 1) }))).toMatchObject({ status: 404 });
    expect(await err(svc().upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes: Buffer.from('GIF89a...') }))).toMatchObject({ code: 'UNSUPPORTED_TYPE', status: 415 });
    expect(await err(svc().upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes: makeImageBytes('png', 2, 5 * 1024 * 1024 + 1) }))).toMatchObject({ code: 'TOO_LARGE', status: 413 });
    expect((await pool.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n).toBe(before);
  });
  it('the job handler stores OK with model_id and assessed_at; the payload carries the disclaimer', async () => {
    const f = await uploaded(10);
    const s = svc();
    const pending = await s.get(f.actor, f.mediaId);
    expect(pending).toMatchObject({ status: 'PENDING', result: null, disclaimer_th: ASSESSMENT_DISCLAIMER_TH });
    const handlers = registerAssessImage(new HandlerRegistry(), { assessment: s, assessor: assessorOf([{ type: 'json', value: good }]) });
    const tick = await new JobRunner({ queue: queue(), handlers }).tick();
    expect(tick.done).toBeGreaterThanOrEqual(1);
    const p = await s.get(f.actor, f.mediaId);
    expect(p).toMatchObject({ media_id: f.mediaId, status: 'OK', result: good, model_id: 'mock-vision', disclaimer_th: ASSESSMENT_DISCLAIMER_TH });
    expect(p.assessed_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect((await jobFor(f.mediaId))[0]!.status).toBe('DONE');
  });
  it('strips claims from a stored result and stores UNASSESSABLE when nothing is left', async () => {
    const a = await uploaded(20);
    const b = await uploaded(21);
    const s = svc();
    const lying = { ...good, color: 'ชื้น 12%', visible_contaminants: ['เกรด A', 'ดิน'] };
    await s.runAssessment(a.mediaId, assessorOf([{ type: 'json', value: lying }]), { attempt: 1, maxAttempts: 3 });
    const pa = await s.get(a.actor, a.mediaId);
    expect(pa.status).toBe('OK');
    expect(pa.result).toMatchObject({ color: '', visible_contaminants: ['ดิน'] });
    expect(JSON.stringify(pa.result)).not.toMatch(/%|เกรด/);
    const empty = { likely_material: 'UNKNOWN', color: '15 MJ', surface_condition: 'มาตรฐาน', visible_contaminants: [], limitations: [], follow_up_questions: [] };
    await s.runAssessment(b.mediaId, assessorOf([{ type: 'json', value: empty }]), { attempt: 1, maxAttempts: 3 });
    expect(await s.get(b.actor, b.mediaId)).toMatchObject({ status: 'UNASSESSABLE', result: null });
  });
  it('maps injection output, disabled vision and unsupported model without failing the job', async () => {
    const a = await uploaded(30);
    const b = await uploaded(31);
    const c = await uploaded(32);
    const s = svc();
    const run = (id: string, ass: ReturnType<typeof assessorOf>) => s.runAssessment(id, ass, { attempt: 1, maxAttempts: 3 });
    expect(await run(a.mediaId, assessorOf([{ type: 'injection' }]))).toEqual({ done: true, status: 'UNASSESSABLE' });
    expect(await run(b.mediaId, assessorOf([{ type: 'json', value: good }], false))).toEqual({ done: true, status: 'UNAVAILABLE' });
    expect(await run(c.mediaId, assessorOf([{ type: 'unsupported_image' }]))).toEqual({ done: true, status: 'UNAVAILABLE' });
    expect((await imageAssessments.getByMedia(pool, b.mediaId))?.error_code).toBe('VISION_DISABLED');
    expect((await imageAssessments.getByMedia(pool, a.mediaId))?.result).toBeNull();
  });
  it('retries a transient error until the last attempt, then stores FAILED', async () => {
    const f = await uploaded(40);
    const s = svc();
    const ass = assessorOf([{ type: 'timeout' }]);
    expect(await s.runAssessment(f.mediaId, ass, { attempt: 1, maxAttempts: 3 })).toEqual({ done: false, retryCode: 'TIMEOUT' });
    expect(await imageAssessments.getByMedia(pool, f.mediaId)).toBeNull();
    expect(await s.runAssessment(f.mediaId, ass, { attempt: 3, maxAttempts: 3 })).toEqual({ done: true, status: 'FAILED' });
    expect((await s.get(f.actor, f.mediaId)).status).toBe('FAILED');
  });
  it('a result belongs to one media id: another image of the same listing stays PENDING', async () => {
    const f = await uploaded(50);
    const other = await svc().upload(f.actor, { ownerType: 'LISTING', ownerId: f.listing.id, bytes: makeImageBytes('jpeg', 51) });
    await svc().runAssessment(f.mediaId, assessorOf([{ type: 'json', value: good }]), { attempt: 1, maxAttempts: 3 });
    expect((await svc().get(f.actor, other.mediaId)).status).toBe('PENDING');
  });
  it("another organization cannot read an assessment", async () => {
    const f = await uploaded(60);
    const other = await farmer();
    const e = await svc().get(other.actor, f.mediaId).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(MediaServiceError);
    expect(e).toMatchObject({ status: 404 });
  });
  describe('HTTP routes', () => {
    let server: Server;
    let base: string;
    let current: Actor;
    beforeAll(async () => {
      const app = createApp({
        env: EnvSchema.parse({}),
        logger: createLogger('silent'),
        mountRoutes: (a) => {
          a.use((req, _res, next) => {
            req.auth = { actor: current } as never;
            next();
          });
          a.use(mediaRoutes(svc()));
        },
      });
      server = await new Promise<Server>((r) => {
        const s = app.listen(0, '127.0.0.1', () => r(s));
      });
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));
    const post = (q: string, body: Uint8Array, type = 'image/jpeg') =>
      fetch(`${base}/media?${q}`, { method: 'POST', headers: { 'content-type': type }, body });
    it('uploads, serves content to the owner only, and returns the assessment with the disclaimer', async () => {
      const f = await farmer();
      const other = await farmer();
      current = f.actor;
      const bytes = makeImageBytes('jpeg', 70);
      const up = await post(`owner_type=LISTING&owner_id=${f.listing.id}`, bytes, 'application/octet-stream');
      expect(up.status).toBe(202);
      const body = (await up.json()) as { media_id: string; assessment_status: string };
      expect(body.assessment_status).toBe('PENDING');
      expect(JSON.stringify(body)).not.toMatch(/storage_key|sha256/);
      const content = await fetch(`${base}/media/${body.media_id}/content`);
      expect(content.status).toBe(200);
      expect(content.headers.get('content-type')).toBe('image/jpeg');
      expect(Buffer.from(await content.arrayBuffer()).equals(bytes)).toBe(true);
      const url = (await (await fetch(`${base}/media/${body.media_id}/url`)).json()) as { url: string };
      expect((await fetch(`${base}${url.url}`)).status).toBe(200);
      expect((await fetch(`${base}/media/${body.media_id}/content?token=bad.token`)).status).toBe(403);
      const as = (await (await fetch(`${base}/media/${body.media_id}/assessment`)).json()) as { status: string; disclaimer_th: string };
      expect(as).toMatchObject({ status: 'PENDING', disclaimer_th: ASSESSMENT_DISCLAIMER_TH });
      current = other.actor;
      expect((await fetch(`${base}/media/${body.media_id}/content`)).status).toBe(404);
      expect((await fetch(`${base}/media/${body.media_id}/assessment`)).status).toBe(404);
    });
    it('answers 415, 413, 422 and 404 for bad uploads', async () => {
      const f = await farmer();
      current = f.actor;
      const q = `owner_type=LISTING&owner_id=${f.listing.id}`;
      expect((await post(q, Buffer.from('not an image'))).status).toBe(415);
      expect((await post(q, Buffer.alloc(0))).status).toBe(400);
      expect((await post(q, makeImageBytes('png', 1, 5 * 1024 * 1024 + 1))).status).toBe(413);
      expect((await post('owner_type=NOPE', makeImageBytes('png', 3))).status).toBe(422);
      expect((await post('owner_type=LISTING&owner_id=00000000-0000-4000-8000-000000000000', makeImageBytes('png', 4))).status).toBe(404);
    });
  });
});
