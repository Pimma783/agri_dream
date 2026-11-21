// Task 16.2. Feature: agrimatch-mvp, Property 13: Resale allocation never exceeds the source agreement (real Postgres).
// **Validates: Requirements 14.4, 14.5, 14.11**
// Random sequences of resale draft create, quantity patch, draft cancel, publish, partial sale and listing close/cancel run against one
// PURCHASE_CONFIRMED agreement. After every step: sum of ACTIVE allocations = agreements.resale_reserved_kg = the model, <= agreement qty,
// every ACTIVE allocation is >= 0 and >= its listing's total (draft-linked) or equals the model, and refused requests write nothing.
// Close/cancel keeps the sold quantity reserved and releases the rest. Only the buyer BALER may create. Concurrent creates respect the cap.
import fc from 'fast-check';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor, Role } from '../src/domain/permissions.js';
import { agreements, resaleAllocations } from '../src/repos/index.js';
import {
  createDraftService, createListingService, createResaleService, type Result,
} from '../src/services/index.js';
import { createTestDb, runConcurrently, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOffer, makeOrgWithUser } from './factories.js';

const codeOf = <T>(r: Result<T>): string => (r.ok ? 'OK' : r.error.code);
const num = (s: unknown) => Number(s ?? 0);
const COMPLETE = { price_mode: 'NEGOTIABLE', province: 'Uttaradit', lat: '17.620000', lng: '100.100000', expected_ready_at: '2030-01-01' } as const;

type Op =
  | { t: 'create'; qty: number | null }
  | { t: 'patch' | 'cancelDraft' | 'publish'; i: number; qty: number }
  | { t: 'sell'; i: number; pct: number }
  | { t: 'close' | 'cancelListing'; i: number }
  | { t: 'intruder'; who: 0 | 1 | 2; qty: number };

const unitArb = fc.integer({ min: 1, max: 12 }).map((n) => n * 100);
const idx = fc.nat({ max: 10 });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ t: fc.constant('create' as const), qty: fc.option(unitArb, { nil: null }) }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('patch' as const), i: idx, qty: unitArb }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('cancelDraft' as const), i: idx, qty: fc.constant(0) }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('publish' as const), i: idx, qty: fc.constant(0) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('sell' as const), i: idx, pct: fc.integer({ min: 0, max: 100 }) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constantFrom('close' as const, 'cancelListing' as const), i: idx }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('intruder' as const), who: fc.constantFrom(0 as const, 1 as const, 2 as const), qty: unitArb }) },
);

interface MDraft { id: string; qty: number; status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'ENDED'; listingId?: string; sold: number }

describe.skipIf(!testDatabaseUrl)('resale allocation (real Postgres, property)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let resale: ReturnType<typeof createResaleService>;
  let drafts: ReturnType<typeof createDraftService>;
  let listings: ReturnType<typeof createListingService>;
  type Party = Awaited<ReturnType<typeof makeOrgWithUser>>;
  let farmer: Party;
  let baler: Party;
  let otherBaler: Party;
  let factory: Party;
  const actorOf = (p: Party, role: Role): Actor => ({ userId: p.user.id, orgId: p.org.id, role, channel: 'web' });

  beforeAll(async () => {
    db = await createTestDb();
    pool = db.pool;
    resale = createResaleService({ pool });
    drafts = createDraftService({ pool });
    listings = createListingService({ pool });
    farmer = await makeOrgWithUser(pool, 'FARMER');
    baler = await makeOrgWithUser(pool, 'BALER');
    otherBaler = await makeOrgWithUser(pool, 'BALER');
    factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
  });
  afterAll(async () => {
    await db?.close();
  });

  async function newAgreement(qty: number) {
    const q = `${qty}.000`;
    const src = await makeListing(pool, farmer.org.id, { qty: q, material_type: 'CANE_LEAF' });
    const demand = await makeDemand(pool, baler.org.id, { accepted_materials: ['CANE_LEAF'] });
    const offer = await makeOffer(pool, { listing: src, demand }, { qty_kg: q });
    return agreements.insert(pool, {
      kind: 'PURCHASE', offer_id: offer.id, seller_org_id: farmer.org.id, buyer_org_id: baler.org.id,
      listing_id: src.id, demand_id: demand.id, qty_kg: q, status: 'PURCHASE_CONFIRMED',
    });
  }
  const snapshot = async (agreementId: string) => {
    const a = await pool.query(`SELECT resale_reserved_kg::text AS r FROM agreements WHERE id = $1`, [agreementId]);
    const d = await pool.query(`SELECT count(*)::int AS n FROM drafts WHERE source_agreement_id = $1`, [agreementId]);
    const al = await pool.query(`SELECT id, qty_kg::text, status FROM resale_allocations WHERE source_agreement_id = $1 ORDER BY id`, [agreementId]);
    return JSON.stringify([a.rows, d.rows, al.rows]);
  };

  it('keeps ACTIVE allocations = resale_reserved_kg <= agreement qty under any operation sequence', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 20 }).map((n) => n * 100), fc.array(opArb, { minLength: 1, maxLength: 14 }), async (Q, ops) => {
        const ag = await newAgreement(Q);
        const balerActor = actorOf(baler, 'BALER');
        const model: MDraft[] = [];
        const live = () => model.filter((m) => m.status === 'DRAFT' || m.status === 'PUBLISHED' || (m.status === 'ENDED' && m.sold > 0));
        const reservedModel = () => live().reduce((s, m) => s + (m.status === 'ENDED' ? m.sold : m.qty), 0);
        const pick = (i: number, ...st: MDraft['status'][]) => {
          const xs = model.filter((m) => st.includes(m.status));
          return xs.length ? xs[i % xs.length]! : undefined;
        };

        const check = async () => {
          const reserved = num((await agreements.get(pool, ag.id))!.resale_reserved_kg);
          const active = num(await resaleAllocations.activeTotal(pool, ag.id));
          expect(reserved, 'reserved matches the model').toBe(reservedModel());
          expect(active, 'sum of ACTIVE allocations = resale_reserved_kg').toBe(reserved);
          expect(reserved).toBeGreaterThanOrEqual(0);
          expect(reserved, 'reserved <= agreement qty').toBeLessThanOrEqual(Q);
          for (const m of model) {
            const a = await resaleAllocations.getByDraft(pool, m.id);
            if (m.status === 'CANCELLED' || (m.status === 'ENDED' && m.sold === 0)) {
              expect(a?.status, 'released').toBe('RELEASED');
            } else {
              expect(a?.status).toBe('ACTIVE');
              expect(num(a!.qty_kg)).toBe(m.status === 'ENDED' ? m.sold : m.qty);
            }
            if (m.status === 'PUBLISHED') {
              const l = await pool.query<{ total: string }>(`SELECT total_qty_kg::text AS total FROM material_listings WHERE id = $1`, [m.listingId]);
              expect(num(l.rows[0]!.total), 'listing qty <= its allocation').toBeLessThanOrEqual(num(a!.qty_kg));
            }
          }
        };

        await check();
        for (const op of ops) {
          switch (op.t) {
            case 'create': {
              const before = await snapshot(ag.id);
              const want = op.qty ?? Q - reservedModel();
              const r = await resale.createDraft(balerActor, { agreementId: ag.id, ...(op.qty === null ? {} : { qtyKg: String(op.qty) }) });
              if (want <= 0 || reservedModel() + want > Q) {
                expect(codeOf(r)).toBe('ALLOCATION_EXCEEDED');
                expect(await snapshot(ag.id), 'refused create writes nothing').toBe(before);
              } else {
                expect(codeOf(r)).toBe('OK');
                if (r.ok) {
                  expect(num(r.value.draft.data.qty_kg)).toBe(want);
                  model.push({ id: r.value.draft.id, qty: want, status: 'DRAFT', sold: 0 });
                }
              }
              break;
            }
            case 'patch': {
              const m = pick(op.i, 'DRAFT');
              if (!m) break;
              const cur = await drafts.get(balerActor, m.id);
              if (!cur.ok) throw new Error(`get ${cur.error.code}`);
              const before = await snapshot(ag.id);
              const r = await drafts.patch(balerActor, { draftId: m.id, expectedVersion: cur.value.draft.version, patch: { quantity: { value: String(op.qty), unit: 'kg' } } });
              if (reservedModel() - m.qty + op.qty > Q) {
                expect(codeOf(r)).toBe('ALLOCATION_EXCEEDED');
                expect(await snapshot(ag.id), 'refused patch writes nothing').toBe(before);
              } else {
                expect(codeOf(r)).toBe('OK');
                m.qty = op.qty;
              }
              break;
            }
            case 'cancelDraft': {
              const m = pick(op.i, 'DRAFT');
              if (!m) break;
              const cur = await drafts.get(balerActor, m.id);
              if (!cur.ok) throw new Error(`get ${cur.error.code}`);
              expect(codeOf(await drafts.cancel(balerActor, { draftId: m.id, expectedVersion: cur.value.draft.version }))).toBe('OK');
              m.status = 'CANCELLED';
              break;
            }
            case 'publish': {
              const m = pick(op.i, 'DRAFT');
              if (!m) break;
              const cur = await drafts.get(balerActor, m.id);
              if (!cur.ok) throw new Error(`get ${cur.error.code}`);
              const p = await drafts.patch(balerActor, { draftId: m.id, expectedVersion: cur.value.draft.version, patch: COMPLETE });
              if (!p.ok) throw new Error(`complete patch ${p.error.code}`);
              const pub = await drafts.publish(balerActor, { draftId: m.id, expectedVersion: p.value.draft.version });
              expect(codeOf(pub)).toBe('OK');
              if (pub.ok) {
                m.status = 'PUBLISHED';
                m.listingId = pub.value.entity_id;
              }
              break;
            }
            case 'sell': {
              const m = pick(op.i, 'PUBLISHED');
              if (!m) break;
              const sold = Math.max(m.sold, Math.floor((m.qty * op.pct) / 100));
              if (sold >= m.qty) break; // keep the listing open; a fully sold listing closes through the offer flow, not here
              await pool.query(`UPDATE material_listings SET committed_qty_kg = $2, remaining_qty_kg = total_qty_kg - $2 WHERE id = $1`, [m.listingId, sold]);
              m.sold = sold;
              break;
            }
            case 'close':
            case 'cancelListing': {
              const m = pick(op.i, 'PUBLISHED');
              if (!m) break;
              const l = await pool.query<{ version: number }>(`SELECT version FROM material_listings WHERE id = $1`, [m.listingId]);
              const args = { id: m.listingId!, expectedVersion: l.rows[0]!.version };
              const r = op.t === 'close' ? await listings.close(balerActor, args) : await listings.cancel(balerActor, args);
              expect(codeOf(r)).toBe('OK');
              m.status = 'ENDED';
              break;
            }
            case 'intruder': {
              const before = await snapshot(ag.id);
              const actor = [actorOf(farmer, 'FARMER'), actorOf(factory, 'BUYER_FACTORY'), actorOf(otherBaler, 'BALER')][op.who]!;
              const r = await resale.createDraft(actor, { agreementId: ag.id, qtyKg: String(op.qty) });
              expect(codeOf(r)).toBe(op.who === 2 ? 'NOT_FOUND' : 'FORBIDDEN');
              expect(await snapshot(ag.id), 'refused create writes nothing').toBe(before);
              break;
            }
          }
          await check();
        }
      }),
    );
  }, 900_000);

  it('concurrent creates never exceed the agreement quantity and refusals are ALLOCATION_EXCEEDED', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 15 }).map((n) => n * 100),
        fc.array(unitArb, { minLength: 2, maxLength: 8 }),
        async (Q, qtys) => {
          const ag = await newAgreement(Q);
          const balerActor = actorOf(baler, 'BALER');
          const results = await runConcurrently(qtys.length, (k) => resale.createDraft(balerActor, { agreementId: ag.id, qtyKg: String(qtys[k]!) }));
          const outcomes = results.map((r) => (r.status === 'fulfilled' ? codeOf(r.value) : 'THROWN'));
          expect(outcomes.every((o) => o === 'OK' || o === 'ALLOCATION_EXCEEDED'), outcomes.join(',')).toBe(true);
          const okQty = results.reduce((s, r) => (r.status === 'fulfilled' && r.value.ok ? s + num(r.value.value.draft.data.qty_kg) : s), 0);
          expect(okQty).toBeLessThanOrEqual(Q);
          expect(num((await agreements.get(pool, ag.id))!.resale_reserved_kg)).toBe(okQty);
          expect(num(await resaleAllocations.activeTotal(pool, ag.id))).toBe(okQty);
          const n = await pool.query(`SELECT count(*)::int AS n FROM drafts WHERE source_agreement_id = $1`, [ag.id]);
          expect(n.rows[0].n).toBe(outcomes.filter((o) => o === 'OK').length);
        },
      ),
    );
  }, 900_000);
});
