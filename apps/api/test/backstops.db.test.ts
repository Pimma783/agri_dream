// Task 4.6: database backstops. Every write below is raw SQL on a pool connection, so no service
// code is involved. Each assertion names the SQLSTATE and, where Postgres reports one, the constraint.
// Each rejected statement runs in its own rolled-back transaction (a failed statement aborts the transaction).
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb, testDatabaseUrl } from './db-helper.js';
import { makeMarket } from './factories.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const INTEGRITY_VIOLATION = '23000'; // integrity_constraint_violation, raised by the append-only triggers

interface Expected {
  code: string;
  constraint?: string | RegExp;
  message?: RegExp;
}

describe.skipIf(!testDatabaseUrl)('database backstops (raw SQL, bypassing services)', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  type Tx = pg.PoolClient;
  type Market = Awaited<ReturnType<typeof makeMarket>>;

  /** Seeds a market in a transaction, runs `sql`, and asserts Postgres refuses it with the expected error. */
  const refuses = (
    expected: Expected,
    run: (tx: Tx, m: Market) => Promise<unknown>,
  ) =>
    db.withRollback(async (tx) => {
      const m = await makeMarket(tx);
      const err = await run(tx, m).then(
        () => undefined,
        (e: unknown) => e as pg.DatabaseError,
      );
      expect(err, 'the write must be refused').toBeDefined();
      expect(err?.code).toBe(expected.code);
      if (typeof expected.constraint === 'string') expect(err?.constraint).toBe(expected.constraint);
      else if (expected.constraint) expect(err?.constraint).toMatch(expected.constraint);
      if (expected.message) expect(err?.message).toMatch(expected.message);
    });

  const insertListing = (tx: Tx, orgId: string, total: string, committed: string, remaining: string) =>
    tx.query(
      `INSERT INTO material_listings (org_id, kind, material_type, total_qty_kg, committed_qty_kg, remaining_qty_kg, price_mode, unit_price_thb, price_unit, status)
       VALUES ($1,'SALE','RICE_STRAW',$2,$3,$4,'FIXED',1.5,'KG','PUBLISHED')`,
      [orgId, total, committed, remaining],
    );
  const insertAgreement = (tx: Tx, m: Market, qty = '10') =>
    tx.query(
      `INSERT INTO agreements (kind, offer_id, seller_org_id, buyer_org_id, listing_id, demand_id, qty_kg, status)
       VALUES ('PURCHASE',$1,$2,$3,$4,$5,$6,'PURCHASE_CONFIRMED') RETURNING id`,
      [m.offer.id, m.farmer.org.id, m.factory.org.id, m.listing.id, m.demand.id, qty],
    );

  describe('quantity balance', () => {
    it('refuses overselling: total <> committed + remaining on a listing (qty_balance)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'qty_balance' }, (tx, m) =>
        insertListing(tx, m.farmer.org.id, '100', '40', '50')));

    it('refuses an update that commits more than total without reducing remaining (qty_balance)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'qty_balance' }, (tx, m) =>
        tx.query(`UPDATE material_listings SET committed_qty_kg = committed_qty_kg + 1 WHERE id = $1`, [m.listing.id])));

    it('refuses negative remaining even when the balance holds (remaining_qty_kg check)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'material_listings_remaining_qty_kg_check' }, (tx, m) =>
        insertListing(tx, m.farmer.org.id, '100', '110', '-10')));

    it('refuses an update that drives remaining below zero (remaining_qty_kg check)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'material_listings_remaining_qty_kg_check' }, (tx, m) =>
        tx.query(
          `UPDATE material_listings SET committed_qty_kg = total_qty_kg + 1, remaining_qty_kg = -1 WHERE id = $1`,
          [m.listing.id],
        )));

    it('applies the same balance to purchase demands (demand_qty_balance)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'demand_qty_balance' }, (tx, m) =>
        tx.query(`UPDATE purchase_demands SET committed_qty_kg = 1 WHERE id = $1`, [m.demand.id])));

    it('refuses negative remaining on a purchase demand', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'purchase_demands_remaining_qty_kg_check' }, (tx, m) =>
        tx.query(
          `UPDATE purchase_demands SET committed_qty_kg = target_qty_kg + 5, remaining_qty_kg = -5 WHERE id = $1`,
          [m.demand.id],
        )));

    it('accepts a balanced update (control)', () =>
      db.withRollback(async (tx) => {
        const m = await makeMarket(tx);
        const r = await tx.query(
          `UPDATE material_listings SET committed_qty_kg = 4000, remaining_qty_kg = total_qty_kg - 4000 WHERE id = $1`,
          [m.listing.id],
        );
        expect(r.rowCount).toBe(1);
      }));
  });

  describe('price_shape', () => {
    it('refuses NEGOTIABLE with a price (price_shape)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'price_shape' }, (tx, m) =>
        tx.query(`UPDATE material_listings SET price_mode = 'NEGOTIABLE' WHERE id = $1`, [m.listing.id]))); // keeps unit_price_thb

    it('refuses NEGOTIABLE stored as a zero price (price_shape)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'price_shape' }, (tx, m) =>
        tx.query(`UPDATE material_listings SET price_mode = 'NEGOTIABLE', unit_price_thb = 0 WHERE id = $1`, [m.listing.id])));

    it('refuses FIXED without a price (price_shape)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'price_shape' }, (tx, m) =>
        tx.query(`UPDATE material_listings SET unit_price_thb = NULL, price_unit = NULL WHERE id = $1`, [m.listing.id])));

    it('refuses FIXED without a unit (price_shape)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'price_shape' }, (tx, m) =>
        tx.query(`UPDATE material_listings SET price_unit = NULL WHERE id = $1`, [m.listing.id])));

    it('applies the same shape rule to demands (demand_price_shape)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'demand_price_shape' }, (tx, m) =>
        tx.query(`UPDATE purchase_demands SET price_mode = 'NEGOTIABLE' WHERE id = $1`, [m.demand.id])));
  });

  describe('agreements', () => {
    it('refuses a second agreement for the same offer (agreements_offer_id_key)', () =>
      refuses({ code: UNIQUE_VIOLATION, constraint: 'agreements_offer_id_key' }, async (tx, m) => {
        await insertAgreement(tx, m);
        await insertAgreement(tx, m);
      }));

    it('refuses resale_reserved_kg above the agreement quantity (resale_cap)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'resale_cap' }, async (tx, m) => {
        const a = (await insertAgreement(tx, m, '1000')).rows[0].id;
        await tx.query(`UPDATE agreements SET resale_reserved_kg = 1000.001 WHERE id = $1`, [a]);
      }));

    it('refuses negative resale_reserved_kg (resale_cap)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'resale_cap' }, async (tx, m) => {
        const a = (await insertAgreement(tx, m, '1000')).rows[0].id;
        await tx.query(`UPDATE agreements SET resale_reserved_kg = -0.001 WHERE id = $1`, [a]);
      }));

    it('refuses shrinking qty_kg below what is already reserved for resale (resale_cap)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'resale_cap' }, async (tx, m) => {
        const a = (await insertAgreement(tx, m, '1000')).rows[0].id;
        await tx.query(`UPDATE agreements SET resale_reserved_kg = 800 WHERE id = $1`, [a]);
        await tx.query(`UPDATE agreements SET qty_kg = 700 WHERE id = $1`, [a]);
      }));

    it('allows reserving exactly the agreement quantity (control)', () =>
      db.withRollback(async (tx) => {
        const m = await makeMarket(tx);
        const a = (await insertAgreement(tx, m, '1000')).rows[0].id;
        const r = await tx.query(`UPDATE agreements SET resale_reserved_kg = 1000 WHERE id = $1`, [a]);
        expect(r.rowCount).toBe(1);
      }));
  });

  describe('quantity_ledger', () => {
    const entry = `INSERT INTO quantity_ledger (subject_type, subject_id, agreement_id, entry_kind, qty_kg)
                   VALUES ('LISTING', $1, $2, 'COMMIT', 10)`;
    // The unique constraint name is auto-generated and longer than 63 characters, so Postgres truncates it.
    const ledgerKey = /^quantity_ledger_agreement_id_subject_type_subject_id/;

    it('refuses a duplicate (agreement, subject, entry kind) row', () =>
      refuses({ code: UNIQUE_VIOLATION, constraint: ledgerKey }, async (tx, m) => {
        const a = (await insertAgreement(tx, m)).rows[0].id;
        await tx.query(entry, [m.listing.id, a]);
        await tx.query(entry, [m.listing.id, a]);
      }));

    it('refuses UPDATE', () =>
      refuses({ code: INTEGRITY_VIOLATION, message: /quantity_ledger is append-only/ }, async (tx, m) => {
        const a = (await insertAgreement(tx, m)).rows[0].id;
        await tx.query(entry, [m.listing.id, a]);
        await tx.query(`UPDATE quantity_ledger SET qty_kg = 1`);
      }));

    it('refuses DELETE', () =>
      refuses({ code: INTEGRITY_VIOLATION, message: /quantity_ledger is append-only/ }, async (tx, m) => {
        const a = (await insertAgreement(tx, m)).rows[0].id;
        await tx.query(entry, [m.listing.id, a]);
        await tx.query(`DELETE FROM quantity_ledger`);
      }));

    // Fixed by migration 1731888300000_quantity-ledger-no-truncate.sql (statement-level BEFORE TRUNCATE trigger).
    it('refuses TRUNCATE', () =>
      refuses({ code: INTEGRITY_VIOLATION, message: /quantity_ledger is append-only/ }, async (tx, m) => {
        const a = (await insertAgreement(tx, m)).rows[0].id;
        await tx.query(entry, [m.listing.id, a]);
        await tx.query(`TRUNCATE quantity_ledger`);
      }));

    it('refuses a non-positive quantity', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'quantity_ledger_qty_kg_check' }, async (tx, m) => {
        const a = (await insertAgreement(tx, m)).rows[0].id;
        await tx.query(entry.replace('10)', '0)'), [m.listing.id, a]);
      }));
  });

  describe('audit_logs', () => {
    const insert = `INSERT INTO audit_logs (channel, action, entity_type, detail) VALUES ('system','backstop.test','thing','{}')`;
    const append = { code: INTEGRITY_VIOLATION, message: /audit_logs is append-only/ };

    it('refuses UPDATE', () =>
      db.withRollback(async (tx) => {
        await tx.query(insert);
        await expect(tx.query(`UPDATE audit_logs SET action = 'tampered'`)).rejects.toMatchObject(append);
      }));

    it('refuses DELETE', () =>
      db.withRollback(async (tx) => {
        await tx.query(insert);
        await expect(tx.query(`DELETE FROM audit_logs`)).rejects.toMatchObject(append);
      }));

    it('refuses TRUNCATE', () =>
      db.withRollback(async (tx) => {
        await tx.query(insert);
        await expect(tx.query(`TRUNCATE audit_logs`)).rejects.toMatchObject(append);
      }));

    it('still accepts INSERT (control)', () =>
      db.withRollback(async (tx) => {
        expect((await tx.query(insert)).rowCount).toBe(1);
      }));
  });

  describe('webhook_events, jobs and notification_outbox dedupe', () => {
    it('refuses a duplicate webhook (channel, event_id) (webhook_events_channel_event_id_key)', () =>
      db.withRollback(async (tx) => {
        const sql = `INSERT INTO webhook_events (channel, event_id, payload) VALUES ('farmer','evt-1','{}')`;
        await tx.query(sql);
        await expect(tx.query(sql)).rejects.toMatchObject({
          code: UNIQUE_VIOLATION,
          constraint: 'webhook_events_channel_event_id_key',
        });
      }));

    it('allows the same event_id on a different channel (control)', () =>
      db.withRollback(async (tx) => {
        const sql = `INSERT INTO webhook_events (channel, event_id, payload) VALUES ($1,'evt-1','{}')`;
        await tx.query(sql, ['farmer']);
        expect((await tx.query(sql, ['baler'])).rowCount).toBe(1);
      }));

    it('refuses a duplicate job dedupe_key (jobs_dedupe_key_key) and lets NULL keys repeat', () =>
      db.withRollback(async (tx) => {
        const sql = `INSERT INTO jobs (kind, payload, dedupe_key) VALUES ('line_event','{}',$1)`;
        await tx.query(sql, [null]);
        await tx.query(sql, [null]);
        await tx.query(sql, ['farmer:evt-1']);
        await expect(tx.query(sql, ['farmer:evt-1'])).rejects.toMatchObject({
          code: UNIQUE_VIOLATION,
          constraint: 'jobs_dedupe_key_key',
        });
      }));

    it('refuses a duplicate outbox dedupe_key (notification_outbox_dedupe_key_key)', () =>
      db.withRollback(async (tx) => {
        const id = (
          await tx.query(
            `INSERT INTO line_identities (channel, line_user_id, status) VALUES ('farmer', 'Ubackstop-' || gen_random_uuid(), 'UNLINKED') RETURNING id`,
          )
        ).rows[0].id;
        const sql = `INSERT INTO notification_outbox (channel, to_line_identity_id, message, dedupe_key) VALUES ('farmer',$1,'{}','agreement:1:created:a')`;
        await tx.query(sql, [id]);
        await expect(tx.query(sql, [id])).rejects.toMatchObject({
          code: UNIQUE_VIOLATION,
          constraint: 'notification_outbox_dedupe_key_key',
        });
      }));
  });

  describe('media', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const insert = (
      tx: Tx,
      m: Market,
      o: { content?: Buffer | null; size?: number; sha?: string; kind?: string; key?: string | null; type?: string } = {},
    ) =>
      tx.query(
        `INSERT INTO media (org_id, owner_type, owner_id, storage_kind, storage_key, content, content_type, size_bytes, sha256)
         VALUES ($1,'DRAFT',gen_random_uuid(),$2,$3,$4,$5,$6,$7)`,
        [
          m.farmer.org.id,
          o.kind ?? 'db',
          o.key ?? null,
          o.content === undefined ? bytes : o.content,
          o.type ?? 'image/jpeg',
          o.size ?? bytes.length,
          o.sha ?? sha,
        ],
      );

    it('accepts a valid image (control)', () =>
      db.withRollback(async (tx) => {
        const m = await makeMarket(tx);
        expect((await insert(tx, m)).rowCount).toBe(1);
      }));

    it('refuses an image over 5 MB (media_size_bytes_check)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'media_size_bytes_check' }, (tx, m) => {
        const over = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
        return insert(tx, m, { content: over, size: over.length });
      }));

    it('refuses a zero size (media_size_bytes_check)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'media_size_bytes_check' }, (tx, m) =>
        insert(tx, m, { content: Buffer.alloc(0), size: 0 })));

    it('refuses a malformed sha256 (media_sha256_check)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'media_sha256_check' }, (tx, m) =>
        insert(tx, m, { sha: 'not-a-hash' })));

    it('refuses uppercase sha256 (media_sha256_check)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'media_sha256_check' }, (tx, m) =>
        insert(tx, m, { sha: sha.toUpperCase() })));

    it('refuses size_bytes that differs from the stored content length (media_storage_shape)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'media_storage_shape' }, (tx, m) => insert(tx, m, { size: 99 })));

    it('refuses a db row without content (media_storage_shape)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'media_storage_shape' }, (tx, m) => insert(tx, m, { content: null })));

    it('refuses an s3 row that also carries content (media_storage_shape)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'media_storage_shape' }, (tx, m) =>
        insert(tx, m, { kind: 's3', key: 'media/x' })));

    it('refuses an s3 row without a storage_key (media_storage_shape)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'media_storage_shape' }, (tx, m) =>
        insert(tx, m, { kind: 's3', content: null })));

    it('refuses a content type other than jpeg or png (media_content_type_check)', () =>
      refuses({ code: CHECK_VIOLATION, constraint: 'media_content_type_check' }, (tx, m) =>
        insert(tx, m, { type: 'image/gif' })));

    it('refuses the same image twice for one owner (media_owner_type_owner_id_sha256_key)', () =>
      refuses({ code: UNIQUE_VIOLATION, constraint: 'media_owner_type_owner_id_sha256_key' }, async (tx, m) => {
        const owner = (await tx.query(`SELECT gen_random_uuid() AS id`)).rows[0].id;
        const sql = `INSERT INTO media (org_id, owner_type, owner_id, content, content_type, size_bytes, sha256)
                     VALUES ($1,'DRAFT',$2,$3,'image/jpeg',$4,$5)`;
        const p = [m.farmer.org.id, owner, bytes, bytes.length, sha];
        await tx.query(sql, p);
        await tx.query(sql, p);
      }));
  });
});
