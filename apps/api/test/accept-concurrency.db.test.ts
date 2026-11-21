// Task 8.5: concurrency and atomicity of the accept-offer transaction (Requirements 12.4, 12.5, 12.7).
// Every race here runs over separate pooled connections against real Postgres. Production code is not touched.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/domain/permissions.js';
import { agreements, demands, lineIdentities, listings, lockRows, offers } from '../src/repos/index.js';
import { createOfferService, type AcceptResult, type OfferService, type Result } from '../src/services/index.js';
import { createTestDb, runConcurrently, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeDemand, makeListing, makeOffer, makeOrgWithUser } from './factories.js';

const N = 8;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe.skipIf(!testDatabaseUrl)('accept offer: concurrency and atomicity (real Postgres)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let svc: OfferService;
  beforeAll(async () => {
    db = await createTestDb({ max: 24 });
    pool = db.pool;
    svc = createOfferService({ pool });
  });
  afterAll(async () => {
    await db?.close();
  });

  type Party = Awaited<ReturnType<typeof makeOrgWithUser>>;
  const actorOf = (p: Party, role: Actor['role']): Actor => ({ userId: p.user.id, orgId: p.org.id, role, channel: 'web' });
  const val = <T>(r: Result<T>): T => {
    if (!r.ok) throw new Error(`expected Ok, got ${r.error.code}`);
    return r.value;
  };
  const rows = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query<T>(sql, params)).rows;
  const count = async (sql: string, params: unknown[]) => Number((await rows<{ n: string }>(sql, params))[0]!.n);

  async function link(p: Party, channel: 'farmer' | 'baler' | 'factory') {
    const id = await lineIdentities.ensure(pool, channel, `U-synthetic-${p.org.id}`);
    await lineIdentities.link(pool, id.id, p.user.id, p.org.id);
  }
  async function market(over: { listingQty?: string; demandQty?: string } = {}) {
    const farmer = await makeOrgWithUser(pool, 'FARMER');
    const factory = await makeOrgWithUser(pool, 'BUYER_FACTORY');
    await link(farmer, 'farmer');
    await link(factory, 'factory');
    const listing = await makeListing(pool, farmer.org.id, over.listingQty ? { qty: over.listingQty } : {});
    const demand = await makeDemand(pool, factory.org.id, over.demandQty ? { qty: over.demandQty } : {});
    return { farmer, factory, listing, demand, farmerActor: actorOf(farmer, 'FARMER'), factoryActor: actorOf(factory, 'BUYER_FACTORY') };
  }
  type M = Awaited<ReturnType<typeof market>>;
  const send = async (m: M, qty: string) =>
    val(await svc.create(m.factoryActor, {
      kind: 'PURCHASE', listingId: m.listing.id, demandId: m.demand.id, qtyKg: qty, unitPriceThb: '1.5', priceUnit: 'KG',
    })).offer;

  /** Everything that must be unchanged when an accept is rolled back. */
  async function snapshot(m: M, offerId: string) {
    const l = (await listings.get(pool, m.listing.id))!;
    const d = (await demands.get(pool, m.demand.id))!;
    return {
      listing: [l.committed_qty_kg, l.remaining_qty_kg, l.status, l.version],
      demand: [d.committed_qty_kg, d.remaining_qty_kg, d.status, d.version],
      offerStatus: (await offers.get(pool, offerId))!.status,
      agreements: await count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [offerId]),
      ledger: await count(`SELECT count(*) AS n FROM quantity_ledger WHERE subject_id IN ($1, $2)`, [m.listing.id, m.demand.id]),
      audit: await count(`SELECT count(*) AS n FROM audit_logs WHERE action IN ('offer.accepted','agreement.created') AND (entity_id = $1 OR detail->>'offer_id' = $1::text)`, [offerId]),
      outbox: await count(`SELECT count(*) AS n FROM notification_outbox WHERE related_id = $1 AND dedupe_key LIKE '%:accepted:%'`, [offerId]),
    };
  }

  describe('(a) overselling', () => {
    for (const limit of ['listing', 'demand'] as const) {
      it(`${N} different offers exceeding the ${limit}'s remaining quantity never oversell it`, async () => {
        const m = await market(limit === 'listing' ? { listingQty: '1000' } : { demandQty: '1000' });
        const sent: Awaited<ReturnType<typeof send>>[] = [];
        for (let i = 0; i < N; i++) sent.push(await send(m, '400'));

        const results = await runConcurrently(N, (i) => svc.accept(m.farmerActor, { offerId: sent[i]!.id }));
        const settled = results.map((r) => {
          if (r.status !== 'fulfilled') throw r.reason;
          return r.value;
        });
        const winners = settled.filter((r) => r.ok);
        const losers = settled.filter((r) => !r.ok);
        expect(winners).toHaveLength(2); // 2 x 400 fits in 1000, a third does not
        expect(losers.map((r) => (r.ok ? 'OK' : r.error.code))).toEqual(Array(N - 2).fill('INSUFFICIENT_QUANTITY'));

        const l = (await listings.get(pool, m.listing.id))!;
        const d = (await demands.get(pool, m.demand.id))!;
        const limited = limit === 'listing' ? l : d;
        expect([limited.committed_qty_kg, limited.remaining_qty_kg]).toEqual(['800.000', '200.000']);
        // The CHECK qty_balance (total = committed + remaining) held, and committed never exceeded the total.
        const total = limit === 'listing' ? l.total_qty_kg : d.target_qty_kg;
        expect(Number(limited.committed_qty_kg)).toBeLessThanOrEqual(Number(total));
        expect(Number(limited.committed_qty_kg) + Number(limited.remaining_qty_kg)).toBe(Number(total));

        // Ledger, agreements and the quantity columns agree.
        const ledgerSum = async (id: string) =>
          (await rows<{ s: string }>(`SELECT COALESCE(sum(qty_kg), 0) AS s FROM quantity_ledger WHERE subject_id = $1 AND entry_kind = 'COMMIT'`, [id]))[0]!.s;
        expect(Number(await ledgerSum(m.listing.id))).toBe(800);
        expect(Number(await ledgerSum(m.demand.id))).toBe(800);
        const agr = await rows<{ qty: string }>(`SELECT sum(qty_kg) AS qty FROM agreements WHERE listing_id = $1`, [m.listing.id]);
        expect(Number(agr[0]!.qty)).toBe(800);

        // Losers stay PENDING and wrote nothing; winners are ACCEPTED with exactly one agreement.
        for (let i = 0; i < N; i++) {
          const won = settled[i]!.ok;
          const o = (await offers.get(pool, sent[i]!.id))!;
          expect(o.status).toBe(won ? 'ACCEPTED' : 'PENDING');
          expect(await count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [o.id])).toBe(won ? 1 : 0);
          expect(await count(`SELECT count(*) AS n FROM notification_outbox WHERE related_id = $1 AND dedupe_key LIKE '%:accepted:%'`, [o.id])).toBe(won ? 2 : 0);
        }
      });
    }

    it('exact fit: offers adding up to precisely the remaining quantity all win and close the listing', async () => {
      const m = await market({ listingQty: '800' });
      const sent: Awaited<ReturnType<typeof send>>[] = [];
      for (let i = 0; i < 4; i++) sent.push(await send(m, '200'));
      const results = await runConcurrently(4, (i) => svc.accept(m.farmerActor, { offerId: sent[i]!.id }));
      expect(results.every((r) => r.status === 'fulfilled' && r.value.ok)).toBe(true);
      const l = (await listings.get(pool, m.listing.id))!;
      expect([l.committed_qty_kg, l.remaining_qty_kg, l.status]).toEqual(['800.000', '0.000', 'CLOSED']);
    });
  });

  describe('(b) the same offer accepted concurrently', () => {
    it(`${N} simultaneous accepts of one offer give one agreement, one set of ledger rows and the same agreement to every caller`, async () => {
      const m = await market();
      const o = await send(m, '1000');
      const results = await runConcurrently(N, () => svc.accept(m.farmerActor, { offerId: o.id }));
      const out = results.map((r) => {
        if (r.status !== 'fulfilled') throw r.reason;
        return val(r.value) as AcceptResult;
      });
      expect(new Set(out.map((r) => r.agreement.id)).size).toBe(1);
      expect(out.filter((r) => !r.replayed)).toHaveLength(1);
      expect(out.filter((r) => r.replayed)).toHaveLength(N - 1);
      expect(out.every((r) => r.offer.status === 'ACCEPTED')).toBe(true);

      const agreementId = out[0]!.agreement.id;
      expect(await count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [o.id])).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM quantity_ledger WHERE agreement_id = $1`, [agreementId])).toBe(2);
      expect(await count(`SELECT count(*) AS n FROM audit_logs WHERE action = 'offer.accepted' AND entity_id = $1`, [o.id])).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM audit_logs WHERE action = 'agreement.created' AND entity_id = $1`, [agreementId])).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM notification_outbox WHERE related_id = $1 AND dedupe_key LIKE '%:accepted:%'`, [o.id])).toBe(2);
      const l = (await listings.get(pool, m.listing.id))!;
      expect([l.committed_qty_kg, l.remaining_qty_kg]).toEqual(['1000.000', '9000.000']);
      expect((await agreements.getByOffer(pool, o.id))!.id).toBe(agreementId);
    });

    it('the same Idempotency-Key used concurrently also yields one agreement', async () => {
      const m = await market();
      const o = await send(m, '1000');
      const results = await runConcurrently(N, () => svc.accept(m.farmerActor, { offerId: o.id, idempotencyKey: 'race-key' }));
      const settled = results.map((r) => {
        if (r.status !== 'fulfilled') throw r.reason;
        return r.value;
      });
      // Whatever a caller gets while the first is in flight, no caller may produce a second agreement.
      const okIds = new Set(settled.filter((r) => r.ok).map((r) => (r.ok ? (r.value as AcceptResult).agreement.id : '')));
      expect(okIds.size).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [o.id])).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM quantity_ledger WHERE subject_id = $1`, [m.listing.id])).toBe(1);
    });
  });

  describe('(c) lock order', () => {
    it('two transactions locking the same listing and demand in opposite requested order do not deadlock', async () => {
      const m = await market();
      const clients = await Promise.all([pool.connect(), pool.connect()]);
      try {
        await Promise.all(clients.map((c) => c.query('BEGIN')));
        const targets = [{ table: 'material_listings' as const, id: m.listing.id }, { table: 'purchase_demands' as const, id: m.demand.id }];
        const orders = [targets, [...targets].reverse()];
        const run = async (i: number) => {
          const c = clients[i]!;
          expect(await lockRows(c, orders[i]!)).toBe(2);
          await c.query('SELECT pg_sleep(0.15)'); // hold the locks so the other side must wait
          await c.query('COMMIT');
        };
        // Repeat the pair: a lock-order bug would raise 40P01 here.
        const res = await Promise.allSettled([run(0), run(1)]);
        expect(res.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      } finally {
        for (const c of clients) {
          await c.query('ROLLBACK').catch(() => {});
          c.release();
        }
      }
    });

    it('accepts in both directions over the same listing and demand pair all complete without CONFLICT_RETRY', async () => {
      for (let round = 0; round < 5; round++) {
        const m = await market({ listingQty: '100000' });
        const fromFactory = [];
        const fromFarmer = [];
        for (let i = 0; i < 3; i++) {
          fromFactory.push(await send(m, '100'));
          fromFarmer.push(val(await svc.create(m.farmerActor, { kind: 'PURCHASE', listingId: m.listing.id, demandId: m.demand.id, qtyKg: '100' })).offer);
        }
        const jobs = [
          ...fromFactory.map((o) => () => svc.accept(m.farmerActor, { offerId: o.id })),
          ...fromFarmer.map((o) => () => svc.accept(m.factoryActor, { offerId: o.id })),
        ];
        const results = await runConcurrently(jobs.length, (i) => jobs[i]!());
        const codes = results.map((r) => (r.status === 'rejected' ? `THROWN:${String(r.reason)}` : r.value.ok ? 'OK' : r.value.error.code));
        expect(codes).toEqual(Array(6).fill('OK'));
        expect((await listings.get(pool, m.listing.id))!.committed_qty_kg).toBe('600.000');
      }
    });

    it('accepts across two listings and two demands in every pairing complete without deadlock', async () => {
      const farmers = [await makeOrgWithUser(pool, 'FARMER'), await makeOrgWithUser(pool, 'FARMER')];
      const factories = [await makeOrgWithUser(pool, 'BUYER_FACTORY'), await makeOrgWithUser(pool, 'BUYER_FACTORY')];
      for (const p of [...farmers, ...factories]) await link(p, p.org.kind === 'FARMER' ? 'farmer' : 'factory');
      const ls = await Promise.all(farmers.map((f) => makeListing(pool, f.org.id, { qty: '100000' })));
      const ds = await Promise.all(factories.map((f) => makeDemand(pool, f.org.id, { qty: '100000' })));
      const sent: { offerId: string; receiver: Actor }[] = [];
      for (let rep = 0; rep < 3; rep++) {
        for (let li = 0; li < 2; li++) {
          for (let di = 0; di < 2; di++) {
            const o = val(await svc.create(actorOf(factories[di]!, 'BUYER_FACTORY'), {
              kind: 'PURCHASE', listingId: ls[li]!.id, demandId: ds[di]!.id, qtyKg: '100', unitPriceThb: '1.5', priceUnit: 'KG',
            })).offer;
            sent.push({ offerId: o.id, receiver: actorOf(farmers[li]!, 'FARMER') });
          }
        }
      }
      const results = await runConcurrently(sent.length, (i) => svc.accept(sent[i]!.receiver, { offerId: sent[i]!.offerId }));
      const codes = results.map((r) => (r.status === 'rejected' ? `THROWN:${String(r.reason)}` : r.value.ok ? 'OK' : r.value.error.code));
      expect(codes).toEqual(Array(sent.length).fill('OK'));
      for (const l of ls) expect((await listings.get(pool, l.id))!.committed_qty_kg).toBe('600.000');
      for (const d of ds) expect((await demands.get(pool, d.id))!.committed_qty_kg).toBe('600.000');
    });
  });

  describe('(d) atomicity under an injected failure', () => {
    /** Create a trigger in this file's schema that raises for one row only, run `fn`, and always drop it. */
    async function withFailingTrigger(table: string, event: 'INSERT' | 'UPDATE', whenSql: string, fn: () => Promise<void>) {
      const name = `inject_${table}_${Math.random().toString(16).slice(2, 10)}`;
      await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'injected failure' USING ERRCODE = 'XX001'; END $f$`);
      await pool.query(`CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW WHEN (${whenSql}) EXECUTE FUNCTION ${name}()`);
      try {
        await fn();
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
        await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
      }
    }

    const cases = [
      // After the agreement and both ledger rows and the listing update have been written.
      { label: 'demand update (after agreement, ledger and listing update)', table: 'purchase_demands', event: 'UPDATE' as const, when: (m: M) => `OLD.id = '${m.demand.id}'` },
      // After everything except the final notification: agreement, ledger, quantities, offer status, audit.
      { label: 'notification insert (after agreement, ledger, quantities, offer status and audit)', table: 'notification_outbox', event: 'INSERT' as const, when: (_m: M, offerId: string) => `NEW.related_id = '${offerId}'` },
    ];
    for (const c of cases) {
      it(`failure at the ${c.label} persists nothing`, async () => {
        const m = await market({ listingQty: '3000' });
        const o = await send(m, '1000');
        const before = await snapshot(m, o.id);
        await withFailingTrigger(c.table, c.event, c.when(m, o.id), async () => {
          await expect(svc.accept(m.farmerActor, { offerId: o.id })).rejects.toThrow(/injected failure/);
        });
        expect(await snapshot(m, o.id)).toEqual(before);
        expect(before).toMatchObject({ offerStatus: 'PENDING', agreements: 0, ledger: 0, outbox: 0 });
        // The failure was transient: with the trigger gone the same offer can still be accepted.
        const r = val(await svc.accept(m.farmerActor, { offerId: o.id })) as AcceptResult;
        expect(r.replayed).toBe(false);
        expect((await listings.get(pool, m.listing.id))!.remaining_qty_kg).toBe('2000.000');
      });
    }

    it('a failure in one concurrent accept does not leak into the others', async () => {
      const m = await market({ listingQty: '10000' });
      const sent: Awaited<ReturnType<typeof send>>[] = [];
      for (let i = 0; i < 4; i++) sent.push(await send(m, '500'));
      const doomed = sent[0]!;
      await withFailingTrigger('notification_outbox', 'INSERT', `NEW.related_id = '${doomed.id}'`, async () => {
        const results = await runConcurrently(4, (i) => svc.accept(m.farmerActor, { offerId: sent[i]!.id }));
        expect(results[0]!.status).toBe('rejected');
        expect(results.slice(1).every((r) => r.status === 'fulfilled' && r.value.ok)).toBe(true);
      });
      expect((await offers.get(pool, doomed.id))!.status).toBe('PENDING');
      expect(await agreements.getByOffer(pool, doomed.id)).toBeNull();
      const l = (await listings.get(pool, m.listing.id))!;
      expect([l.committed_qty_kg, l.remaining_qty_kg]).toEqual(['1500.000', '8500.000']);
      expect(await count(`SELECT count(*) AS n FROM quantity_ledger WHERE subject_id = $1`, [m.listing.id])).toBe(3);
    });
  });

  describe('(e) expiry race', () => {
    it('an offer that expires while the accept waits for its row lock is not accepted', async () => {
      const m = await market();
      const o = await makeOffer(pool, { listing: m.listing, demand: m.demand }, { expires_at: new Date(Date.now() + 1500) });
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM offers WHERE id = $1 FOR UPDATE', [o.id]);
        let settled = false;
        const pending = svc.accept(m.farmerActor, { offerId: o.id }).finally(() => { settled = true; });
        await sleep(300);
        expect(settled).toBe(false); // really blocked on the offer row, before the offer has expired
        await sleep(Math.max(0, o.expires_at.getTime() - Date.now()) + 300);
        expect(settled).toBe(false);
        await holder.query('COMMIT');
        const r = await pending;
        expect(r).toMatchObject({ ok: false, error: { code: 'OFFER_EXPIRED' } });
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }
      expect((await offers.get(pool, o.id))!.status).toBe('PENDING');
      expect(await agreements.getByOffer(pool, o.id)).toBeNull();
      const l = (await listings.get(pool, m.listing.id))!;
      expect([l.committed_qty_kg, l.remaining_qty_kg]).toEqual(['0.000', '10000.000']);
      expect(await count(`SELECT count(*) AS n FROM quantity_ledger WHERE subject_id = $1`, [m.listing.id])).toBe(0);
    });

    it('an accept that wins the lock before expiry commits normally, and a later accept still sees one agreement', async () => {
      const m = await market();
      const o = await makeOffer(pool, { listing: m.listing, demand: m.demand }, { expires_at: new Date(Date.now() + 60_000) });
      const results = await runConcurrently(4, () => svc.accept(m.farmerActor, { offerId: o.id }));
      expect(results.every((r) => r.status === 'fulfilled' && r.value.ok)).toBe(true);
      expect(await count(`SELECT count(*) AS n FROM agreements WHERE offer_id = $1`, [o.id])).toBe(1);
    });
  });
});
