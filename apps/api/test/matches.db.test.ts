// GET /matches and the match read service against real Postgres (task 7.3). Synthetic data only.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMatchExplainPort } from '../src/assistant/index.js';
import { EnvSchema } from '../src/config/env.js';
import type { Actor } from '../src/domain/permissions.js';
import { createApp } from '../src/http/app.js';
import { mountMatchRoutes } from '../src/http/match-routes.js';
import { createLogger } from '../src/logger.js';
import { createAuthService, createDemoOrgUser, LoginRateLimiter } from '../src/services/auth/index.js';
import { createMatchingService, createMatchReadService } from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing } from './factories.js';

const ORIGIN = 'http://localhost:3000';
const PW = 'synthetic-Passw0rd-for-tests';
const NEAR = { lat: '17.620000', lng: '100.100000' };
const NEAR_B = { lat: '17.720000', lng: '100.100000' };
const FARMER_NAME = 'synthetic-farmer-private-name';
const SECRET_DISTRICT = 'synthetic-secret-district';

interface Session { cookie: string; org: { id: string }; user: { id: string } }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = { status: number; body: any };

describe.skipIf(!testDatabaseUrl)('GET /matches (real Postgres)', () => {
  let db: TestDb;
  let server: Server;
  let base: string;
  let seq = 0;
  let farmer: Session;
  let factory: Session;
  let outsider: Session;
  let listingId: string;
  let demandNear: string;
  let demandMissing: string;
  const NOW = new Date('2026-11-18T00:00:00Z');

  async function login(kind: 'FARMER' | 'BALER' | 'BUYER_FACTORY', orgName: string): Promise<Session> {
    const email = `matches-user-${++seq}-${Date.now()}@example.invalid`;
    const { org, user } = await createDemoOrgUser(db.pool, { kind, orgName, email, password: PW });
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password: PW }),
    });
    expect(res.status).toBe(204);
    return { cookie: `agrimatch_sid=${/agrimatch_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`, org, user };
  }
  const get = async (s: Session | null, path: string): Promise<Json> => {
    const res = await fetch(`${base}${path}`, { headers: s ? { cookie: s.cookie } : {} });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const actorOf = (s: Session, role: Actor['role'], channel: Actor['channel'] = 'web'): Actor => ({ userId: s.user.id, orgId: s.org.id, role, channel });

  beforeAll(async () => {
    db = await createTestDb();
    const auth = createAuthService({
      pool: db.pool, config: { idleMs: 3_600_000, absoluteMs: 18_000_000 },
      limiter: new LoginRateLimiter({ maxAttempts: 1000, windowMs: 60_000 }),
    });
    const env = EnvSchema.parse({ NODE_ENV: 'test', WEB_ORIGIN: ORIGIN });
    const app = createApp({ env, logger: createLogger('silent'), auth, mountRoutes: (a) => mountMatchRoutes(a, { pool: db.pool }) });
    server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    farmer = await login('FARMER', FARMER_NAME);
    factory = await login('BUYER_FACTORY', 'synthetic-plant-visible-name');
    outsider = await login('FARMER', 'synthetic-outsider-farmer');
    const l = await makeListing(db.pool, farmer.org.id, { ...NEAR, material_form: 'LOOSE', district: SECRET_DISTRICT, province: 'Uttaradit' });
    const d1 = await makeDemand(db.pool, factory.org.id, { ...NEAR_B, accepted_forms: ['LOOSE'], province: 'Uttaradit' });
    // second demand has no coordinates and no price: lower tier or lower score than d1
    const d2 = await makeDemand(db.pool, factory.org.id, { price_mode: 'NEGOTIABLE', max_unit_price_thb: null, price_unit: null, province: 'Uttaradit', accepted_provinces: ['Uttaradit'] });
    listingId = l.id; demandNear = d1.id; demandMissing = d2.id;
    const matching = createMatchingService({ pool: db.pool, now: () => NOW });
    for (const [t, id] of [['LISTING', l.id], ['DEMAND', d1.id], ['DEMAND', d2.id]] as const) {
      const r = await matching.recompute({ entity_type: t, entity_id: id, version: 1 });
      expect(r.ok).toBe(true);
    }
  });
  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    await db?.close();
  });

  it('requires a session', async () => {
    expect((await get(null, '/matches')).status).toBe(401);
  });

  it('farmer sees own side only, ordered by tier then score, with counterparty published fields', async () => {
    const r = await get(farmer, '/matches');
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThanOrEqual(2);
    for (const m of r.body) {
      expect(m.own_side).toBe('supply');
      expect(m.own_entity_id).toBe(listingId);
      expect(m.counterparty.entity_type).toBe('DEMAND');
      expect(m.score_label_th).toBe('ประมาณการ');
      expect(m.weights_label_th).toBe('น้ำหนักคะแนนเริ่มต้น');
      expect(m.rule_version).toMatch(/^rules-/);
      expect(m.reasons.length).toBeGreaterThan(0);
      expect(m.reasons.every((x: { text_th: string }) => x.text_th.length > 0)).toBe(true);
    }
    const sorted = [...r.body].sort((a, b) => a.tier - b.tier || Number(b.score) - Number(a.score));
    expect(r.body.map((m: { id: string }) => m.id)).toEqual(sorted.map((m: { id: string }) => m.id));
    const near = r.body.find((m: { counterparty: { entity_id: string } }) => m.counterparty.entity_id === demandNear);
    expect(near.distance).toMatchObject({ kind: 'straight_line' });
    expect(near.distance.label_th).toContain('ไม่ใช่ระยะขับรถ');
    expect(r.body.some((m: { counterparty: { entity_id: string } }) => m.counterparty.entity_id === demandMissing)).toBe(true);
  });

  it('factory sees the listing without farmer identity, exact location or contact data', async () => {
    const r = await get(factory, '/matches');
    expect(r.status).toBe(200);
    const m = r.body.find((x: { counterparty: { entity_id: string } }) => x.counterparty.entity_id === listingId);
    expect(m).toBeDefined();
    expect(m.own_side).toBe('demand');
    expect(m.counterparty).toMatchObject({ entity_type: 'LISTING', display_name: null, org_kind: 'FARMER', province: 'Uttaradit' });
    const text = JSON.stringify(r.body);
    for (const secret of [FARMER_NAME, SECRET_DISTRICT, farmer.org.id, farmer.user.id, '17.620000', '100.100000', 'example.invalid']) {
      expect(text).not.toContain(secret);
    }
  });

  it('an unrelated organization sees nothing', async () => {
    const r = await get(outsider, '/matches');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it('filters by entity id and by route; entity of another org yields an empty list', async () => {
    expect((await get(factory, `/matches?entity_id=${demandNear}`)).body.every((m: { own_entity_id: string }) => m.own_entity_id === demandNear)).toBe(true);
    expect((await get(factory, `/matches?entity_id=${demandNear}`)).body.length).toBeGreaterThan(0);
    expect((await get(farmer, `/matches?entity_id=${demandNear}`)).body).toEqual([]);
    expect((await get(farmer, '/matches?route=1')).body.length).toBeGreaterThan(0);
    expect((await get(farmer, '/matches?route=2')).body).toEqual([]);
    expect((await get(farmer, '/matches?limit=1')).body).toHaveLength(1);
  });

  it('rejects invalid query values and unknown keys with 422', async () => {
    expect((await get(farmer, '/matches?route=9')).status).toBe(422);
    expect((await get(farmer, '/matches?entity_id=nope')).status).toBe(422);
    expect((await get(farmer, '/matches?org_id=x')).status).toBe(422);
  });

  it('hides a match whose source version is stale until recompute', async () => {
    const l = await makeListing(db.pool, farmer.org.id, { ...NEAR });
    const d = await makeDemand(db.pool, factory.org.id, { ...NEAR_B });
    const matching = createMatchingService({ pool: db.pool, now: () => NOW });
    await matching.recompute({ entity_type: 'LISTING', entity_id: l.id, version: 1 });
    const before = (await get(farmer, `/matches?entity_id=${l.id}`)).body;
    expect(before.some((m: { counterparty: { entity_id: string } }) => m.counterparty.entity_id === d.id)).toBe(true);
    await db.pool.query('UPDATE material_listings SET version = version + 1 WHERE id = $1', [l.id]);
    expect((await get(farmer, `/matches?entity_id=${l.id}`)).body).toEqual([]);
    await matching.recompute({ entity_type: 'LISTING', entity_id: l.id, version: 2 });
    expect((await get(farmer, `/matches?entity_id=${l.id}`)).body.length).toBeGreaterThan(0);
    // a paused listing is not shown either
    await db.pool.query(`UPDATE material_listings SET status = 'PAUSED' WHERE id = $1`, [l.id]);
    expect((await get(farmer, `/matches?entity_id=${l.id}`)).body).toEqual([]);
  });

  it('service: role and channel mismatch is FORBIDDEN, the assistant channel may read', async () => {
    const svc = createMatchReadService({ pool: db.pool });
    const bad = await svc.list(actorOf(farmer, 'FARMER', 'line:factory'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('FORBIDDEN');
    const okRes = await svc.list(actorOf(farmer, 'FARMER', 'assistant'));
    expect(okRes.ok).toBe(true);
  });

  it('MatchExplainPort returns backend reasons and flags for the actor', async () => {
    const port = createMatchExplainPort(createMatchReadService({ pool: db.pool }));
    const r = await port.listForActor(actorOf(farmer, 'FARMER', 'assistant'), 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.length).toBeGreaterThan(0);
    expect(r.value.length).toBeLessThanOrEqual(3);
    expect(r.value[0]?.reasons.length).toBeGreaterThan(0);
    expect(r.value[0]?.title).toBe('synthetic-plant-visible-name');
    const none = await port.listForActor(actorOf(outsider, 'FARMER', 'assistant'), 3);
    expect(none).toEqual({ ok: true, value: [] });
  });
});
