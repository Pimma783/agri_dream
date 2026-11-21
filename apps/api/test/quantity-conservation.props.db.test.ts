// Task 8.3. Feature: agrimatch-mvp, Property 9: Quantity conservation under any accept sequence (real Postgres).
// **Validates: Requirements 6.8, 12.3, 12.5, 12.6, 12.7, 12.9, 13.2**
// Random sequences of offer create, accept (receiver, repeat and wrong-side), reject, withdraw, expire and baling
// create/accept run against two listings and two demands. After every step, for every row:
//   total = committed + remaining, remaining >= 0, committed = sum of non-cancelled PURCHASE agreements = sum of ledger COMMIT rows,
//   remaining equals an independent model (pending offers reserve nothing), CLOSED iff remaining is 0,
// and baling agreements leave quantity, versions and the ledger untouched. Result codes are checked against the model.
// Concurrent accepts are covered by accept-concurrency.db.test.ts. Resale allocation (task 14) is not part of this file.
import fc from 'fast-check';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/domain/permissions.js';
import { balingRequests, balingServices, lineIdentities } from '../src/repos/index.js';
import { createOfferService, type OfferService } from '../src/services/index.js';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOrgWithUser } from './factories.js';

const HOUR = 3600_000;

type Op =
  | { t: 'create'; l: number; d: number; qty: number; fromFarmer: boolean; short: boolean }
  | { t: 'accept' | 'acceptBySender' | 'reject' | 'withdraw'; i: number }
  | { t: 'expire' }
  | { t: 'balingCreate'; qty: number; fromBaler: boolean }
  | { t: 'balingAccept' | 'balingAcceptBySender'; i: number };

const qtyArb = fc.integer({ min: 1, max: 15 }).map((n) => n * 100);
const idx = fc.nat({ max: 20 });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ t: fc.constant('create' as const), l: fc.nat({ max: 1 }), d: fc.nat({ max: 1 }), qty: qtyArb, fromFarmer: fc.boolean(), short: fc.boolean() }) },
  { weight: 6, arbitrary: fc.record({ t: fc.constant('accept' as const), i: idx }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('acceptBySender' as const), i: idx }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('reject' as const), i: idx }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('withdraw' as const), i: idx }) },
  { weight: 1, arbitrary: fc.constant({ t: 'expire' as const }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('balingCreate' as const), qty: qtyArb, fromBaler: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constantFrom('balingAccept' as const, 'balingAcceptBySender' as const), i: idx }) },
);
const worldArb = fc.record({
  listings: fc.tuple(fc.integer({ min: 2, max: 6 }), fc.integer({ min: 2, max: 6 })).map(([a, b]) => [a * 500, b * 500]),
  demands: fc.tuple(fc.integer({ min: 2, max: 6 }), fc.integer({ min: 2, max: 6 })).map(([a, b]) => [a * 500, b * 500]),
});

type Status = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'EXPIRED';
interface MOffer { id: string; kind: 'PURCHASE' | 'BALING'; l: number; d: number; qty: number; fromSide: 'farmer' | 'factory' | 'baler'; short: boolean; status: Status }
interface MRow { id: string; total: number; remaining: number; closed: boolean }

describe.skipIf(!testDatabaseUrl)('quantity conservation (real Postgres, property)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let svc: OfferService;
  type Party = Awaited<ReturnType<typeof makeOrgWithUser>>;
  let farmers: Party[];
  let factories: Party[];
  let baler: Party;
  const actorOf = (p: Party, role: Actor['role']): Actor => ({ userId: p.user.id, orgId: p.org.id, role, channel: 'web' });

  async function link(p: Party, channel: 'farmer' | 'baler' | 'factory') {
    const id = await lineIdentities.ensure(pool, channel, `U-synthetic-${p.org.id}`);
    await lineIdentities.link(pool, id.id, p.user.id, p.org.id);
  }
  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    svc = createOfferService({ pool });
    farmers = [await makeOrgWithUser(pool, 'FARMER'), await makeOrgWithUser(pool, 'FARMER')];
    factories = [await makeOrgWithUser(pool, 'BUYER_FACTORY'), await makeOrgWithUser(pool, 'BUYER_FACTORY')];
    baler = await makeOrgWithUser(pool, 'BALER');
    for (const f of farmers) await link(f, 'farmer');
    for (const f of factories) await link(f, 'factory');
    await link(baler, 'baler');
  });
  afterAll(async () => {
    await db?.close();
  });

  const num = (s: string | null | undefined) => Number(s ?? 0);

  it('keeps total = committed + remaining and ledger/agreement sums consistent under any operation sequence', async () => {
    await fc.assert(
      fc.asyncProperty(worldArb, fc.array(opArb, { minLength: 1, maxLength: 12 }), async (world, ops) => {
        const L = await Promise.all(world.listings.map((q, k) => makeListing(pool, farmers[k]!.org.id, { qty: `${q}.000` })));
        const D = await Promise.all(world.demands.map((q, k) => makeDemand(pool, factories[k]!.org.id, { qty: `${q}.000` })));
        const service = await balingServices.insert(pool, {
          org_id: baler.org.id, material_types: ['RICE_STRAW'], service_mode: 'BOTH', price_mode: 'FIXED', status: 'PUBLISHED',
          unit_price_thb: '0.5000', price_unit: 'KG', min_qty_kg: '100', is_demo: false,
        });
        const request = await balingRequests.insert(pool, {
          org_id: farmers[0]!.org.id, material_type: 'RICE_STRAW', qty_kg: '5000.000', requested_mode: 'ON_SITE', status: 'PUBLISHED', is_demo: false,
        });
        const ml: MRow[] = L.map((r, k) => ({ id: r.id, total: world.listings[k]!, remaining: world.listings[k]!, closed: false }));
        const md: MRow[] = D.map((r, k) => ({ id: r.id, total: world.demands[k]!, remaining: world.demands[k]!, closed: false }));
        const offersM: MOffer[] = [];
        let purchaseAgreements = 0;
        let balingAgreements = 0;
        const fa = (k: number) => actorOf(farmers[k]!, 'FARMER');
        const ba = (k: number) => actorOf(factories[k]!, 'BUYER_FACTORY');
        const balerActor = actorOf(baler, 'BALER');
        const farmerForRequest = fa(0);
        const actorFor = (o: MOffer, who: 'sender' | 'receiver'): Actor => {
          if (o.kind === 'BALING') return (o.fromSide === 'baler') === (who === 'sender') ? balerActor : farmerForRequest;
          return (o.fromSide === 'farmer') === (who === 'sender') ? fa(o.l) : ba(o.d);
        };
        const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'OK' : r.error!.code);
        const pick = (i: number, kind: MOffer['kind']) => {
          const xs = offersM.filter((o) => o.kind === kind);
          return xs.length ? xs[i % xs.length]! : undefined;
        };

        const check = async () => {
          const ids = [...ml, ...md].map((r) => r.id);
          const lr = await pool.query<{ id: string; total: string; committed: string; remaining: string; status: string }>(
            `SELECT id, total_qty_kg::text AS total, committed_qty_kg::text AS committed, remaining_qty_kg::text AS remaining, status FROM material_listings WHERE id = ANY($1)`, [ids]);
          const dr = await pool.query<{ id: string; total: string; committed: string; remaining: string; status: string }>(
            `SELECT id, target_qty_kg::text AS total, committed_qty_kg::text AS committed, remaining_qty_kg::text AS remaining, status FROM purchase_demands WHERE id = ANY($1)`, [ids]);
          const ag = await pool.query<{ ref: string; kind: string; sum: string; n: string }>(
            `SELECT ref, kind, sum(qty_kg)::text AS sum, count(*)::text AS n FROM (
               SELECT listing_id AS ref, kind, qty_kg FROM agreements WHERE kind = 'PURCHASE' AND status <> 'CANCELLED' AND listing_id = ANY($1)
               UNION ALL
               SELECT demand_id AS ref, kind, qty_kg FROM agreements WHERE kind = 'PURCHASE' AND status <> 'CANCELLED' AND demand_id = ANY($1)) x GROUP BY ref, kind`, [ids]);
          const lg = await pool.query<{ subject_id: string; commits: string; releases: string }>(
            `SELECT subject_id, coalesce(sum(qty_kg) FILTER (WHERE entry_kind = 'COMMIT'), 0)::text AS commits,
                    coalesce(sum(qty_kg) FILTER (WHERE entry_kind = 'RELEASE'), 0)::text AS releases
               FROM quantity_ledger WHERE subject_id = ANY($1) GROUP BY subject_id`, [ids]);
          const rows = [...lr.rows.map((r) => ({ ...r, table: 'listing' })), ...dr.rows.map((r) => ({ ...r, table: 'demand' }))];
          expect(rows).toHaveLength(ids.length);
          for (const r of rows) {
            const m = [...ml, ...md].find((x) => x.id === r.id)!;
            const total = num(r.total);
            const committed = num(r.committed);
            const remaining = num(r.remaining);
            expect(total, `${r.table} total never changes`).toBe(m.total);
            expect(total, `${r.table} total = committed + remaining`).toBe(committed + remaining);
            expect(remaining, `${r.table} remaining >= 0`).toBeGreaterThanOrEqual(0);
            expect(remaining, `${r.table} remaining matches the model (pending offers reserve nothing)`).toBe(m.remaining);
            expect(num(ag.rows.find((a) => a.ref === r.id)?.sum), `${r.table} committed = sum of PURCHASE agreements`).toBe(committed);
            const l = lg.rows.find((x) => x.subject_id === r.id);
            expect(num(l?.commits), `${r.table} committed = sum of ledger COMMIT`).toBe(committed);
            expect(num(l?.releases)).toBe(0);
            expect(r.status, `${r.table} CLOSED iff remaining is 0`).toBe(remaining === 0 ? 'CLOSED' : 'PUBLISHED');
          }
          const all = await pool.query<{ kind: string; n: string }>(
            `SELECT kind, count(*)::text AS n FROM agreements WHERE offer_id = ANY($1) GROUP BY kind`, [offersM.map((o) => o.id)]);
          expect(num(all.rows.find((a) => a.kind === 'PURCHASE')?.n)).toBe(purchaseAgreements);
          expect(num(all.rows.find((a) => a.kind === 'BALING_SERVICE')?.n)).toBe(balingAgreements);
          // Baling never touches the request quantity, status or version.
          expect((await balingRequests.get(pool, request.id))!).toMatchObject({ qty_kg: '5000.000', status: 'PUBLISHED', version: request.version });
          expect((await balingServices.get(pool, service.id))!.version).toBe(service.version);
          if (offersM.length) {
            const os = await pool.query<{ id: string; status: string }>(`SELECT id, status FROM offers WHERE id = ANY($1)`, [offersM.map((o) => o.id)]);
            for (const o of offersM) expect(os.rows.find((x) => x.id === o.id)?.status, `offer ${o.kind} status`).toBe(o.status);
          }
        };

        await check();
        for (const op of ops) {
          switch (op.t) {
            case 'create': {
              const sender = op.fromFarmer ? fa(op.l) : ba(op.d);
              const r = await svc.create(sender, {
                kind: 'PURCHASE', listingId: L[op.l]!.id, demandId: D[op.d]!.id, qtyKg: String(op.qty), unitPriceThb: '1.5', priceUnit: 'KG',
                ...(op.short ? { expiresAt: new Date(Date.now() + HOUR).toISOString() } : {}),
              });
              const l = ml[op.l]!;
              const d = md[op.d]!;
              const expected = l.closed || d.closed ? 'INVALID_STATE' : op.qty > l.remaining || op.qty > d.remaining ? 'INSUFFICIENT_QUANTITY' : 'OK';
              expect(code(r)).toBe(expected);
              if (r.ok) offersM.push({ id: r.value.offer.id, kind: 'PURCHASE', l: op.l, d: op.d, qty: op.qty, fromSide: op.fromFarmer ? 'farmer' : 'factory', short: op.short, status: 'PENDING' });
              break;
            }
            case 'accept': {
              const o = pick(op.i, 'PURCHASE');
              if (!o) break;
              const l = ml[o.l]!;
              const d = md[o.d]!;
              const r = await svc.accept(actorFor(o, 'receiver'), { offerId: o.id });
              if (o.status === 'ACCEPTED') {
                expect(code(r)).toBe('OK');
              } else if (o.status !== 'PENDING') {
                expect(code(r)).toBe('INVALID_STATE');
              } else if (l.closed || d.closed) {
                expect(code(r)).toBe('INVALID_STATE');
              } else if (o.qty > l.remaining || o.qty > d.remaining) {
                expect(code(r)).toBe('INSUFFICIENT_QUANTITY');
              } else {
                expect(code(r)).toBe('OK');
                l.remaining -= o.qty;
                d.remaining -= o.qty;
                l.closed = l.remaining === 0;
                d.closed = d.remaining === 0;
                o.status = 'ACCEPTED';
                purchaseAgreements++;
              }
              break;
            }
            case 'acceptBySender': {
              const o = pick(op.i, 'PURCHASE');
              if (!o) break;
              expect((await svc.accept(actorFor(o, 'sender'), { offerId: o.id })).ok).toBe(false);
              break;
            }
            case 'reject':
            case 'withdraw': {
              const o = offersM.length ? offersM[op.i % offersM.length]! : undefined;
              if (!o) break;
              const who = op.t === 'reject' ? 'receiver' : 'sender';
              const r = op.t === 'reject' ? await svc.reject(actorFor(o, who), { offerId: o.id }) : await svc.withdraw(actorFor(o, who), { offerId: o.id });
              expect(r.ok).toBe(o.status === 'PENDING');
              if (r.ok) o.status = op.t === 'reject' ? 'REJECTED' : 'WITHDRAWN';
              break;
            }
            case 'expire': {
              await svc.expireDue(new Date(Date.now() + 2 * HOUR), 100_000);
              for (const o of offersM) if (o.status === 'PENDING' && o.short) o.status = 'EXPIRED';
              break;
            }
            case 'balingCreate': {
              const r = await svc.create(op.fromBaler ? balerActor : farmerForRequest, {
                kind: 'BALING_SERVICE', balingServiceId: service.id, balingRequestId: request.id, qtyKg: String(op.qty), unitPriceThb: '0.5', priceUnit: 'KG',
              });
              expect(code(r)).toBe('OK');
              if (r.ok) offersM.push({ id: r.value.offer.id, kind: 'BALING', l: 0, d: 0, qty: op.qty, fromSide: op.fromBaler ? 'baler' : 'farmer', short: false, status: 'PENDING' });
              break;
            }
            case 'balingAccept': {
              const o = pick(op.i, 'BALING');
              if (!o) break;
              const r = await svc.accept(actorFor(o, 'receiver'), { offerId: o.id });
              if (o.status === 'ACCEPTED') {
                expect(code(r)).toBe('OK');
              } else if (o.status === 'PENDING') {
                expect(code(r)).toBe('OK');
                o.status = 'ACCEPTED';
                balingAgreements++;
              } else {
                expect(code(r)).toBe('INVALID_STATE');
              }
              break;
            }
            case 'balingAcceptBySender': {
              const o = pick(op.i, 'BALING');
              if (!o) break;
              expect((await svc.accept(actorFor(o, 'sender'), { offerId: o.id })).ok).toBe(false);
              break;
            }
          }
          await check();
        }
      }),
    );
  }, 600_000);
});
