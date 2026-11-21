import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runner } from './db-helper.js';

const url = process.env.TEST_DATABASE_URL;
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');
const base = { databaseUrl: url as string, dir, migrationsTable: 'pgmigrations', log: () => {} };

describe.skipIf(!url)('business-table migrations (real Postgres)', () => {
  let client: pg.Client;
  let seller: string;
  let buyer: string;

  beforeAll(async () => {
    await runner({ ...base, direction: 'down', count: Infinity });
    await runner({ ...base, direction: 'up' });
    client = new pg.Client({ connectionString: url });
    await client.connect();
    const orgs = await client.query(
      `insert into organizations (kind, name, is_demo) values ('FARMER','f',true),('BUYER_FACTORY','b',true) returning id, kind`,
    );
    seller = orgs.rows.find((r) => r.kind === 'FARMER').id;
    buyer = orgs.rows.find((r) => r.kind === 'BUYER_FACTORY').id;
  });
  afterAll(async () => {
    await client?.end();
  });

  const rejects = async (sql: string, params: unknown[] = []) => {
    await client.query('BEGIN');
    try {
      await expect(client.query(sql, params)).rejects.toThrow();
    } finally {
      await client.query('ROLLBACK');
    }
  };
  const listing = (total: string, committed: string, remaining: string) =>
    client.query(
      `insert into material_listings (org_id, kind, material_type, total_qty_kg, committed_qty_kg, remaining_qty_kg, price_mode, status)
       values ($1,'SALE','RICE_STRAW',$2,$3,$4,'NEGOTIABLE','PUBLISHED') returning id`,
      [seller, total, committed, remaining],
    );
  /** Inserts listing + demand + offer + agreement inside the current transaction. */
  const chain = async (qty = '1000') => {
    const l = (await listing('5000', '0', '5000')).rows[0].id;
    const d = (
      await client.query(
        `insert into purchase_demands (org_id, accepted_materials, target_qty_kg, remaining_qty_kg, price_mode, status)
         values ($1, array['RICE_STRAW'], 5000, 5000, 'NEGOTIABLE', 'PUBLISHED') returning id`,
        [buyer],
      )
    ).rows[0].id;
    const o = (
      await client.query(
        `insert into offers (kind, from_org_id, to_org_id, listing_id, demand_id, qty_kg, transport_by, expires_at, status)
         values ('PURCHASE', $1, $2, $3, $4, $5, 'BUYER', now() + interval '1 day', 'PENDING') returning id`,
        [seller, buyer, l, d, qty],
      )
    ).rows[0].id;
    const a = (
      await client.query(
        `insert into agreements (kind, offer_id, seller_org_id, buyer_org_id, listing_id, demand_id, qty_kg, status)
         values ('PURCHASE', $1, $2, $3, $4, $5, $6, 'PURCHASE_CONFIRMED') returning id`,
        [o, seller, buyer, l, d, qty],
      )
    ).rows[0].id;
    return { l, d, o, a };
  };
  const inTx = async (fn: () => Promise<void>) => {
    await client.query('BEGIN');
    try {
      await fn();
    } finally {
      await client.query('ROLLBACK');
    }
  };

  it('creates all business tables with no float columns', async () => {
    const names = [
      'drafts', 'material_listings', 'purchase_demands', 'baling_services', 'baling_requests', 'offers',
      'agreements', 'quantity_ledger', 'resale_allocations', 'media', 'image_assessments', 'matches',
      'conversations', 'messages', 'idempotency_keys',
    ];
    const t = await client.query(
      `select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`,
      [names],
    );
    expect(t.rows).toHaveLength(names.length);
    const f = await client.query(
      `select table_name, column_name from information_schema.columns
       where table_schema='public' and table_name = any($1) and data_type in ('real','double precision')`,
      [names],
    );
    expect(f.rows).toEqual([]);
  });

  it('enforces total = committed + remaining and non-negative remaining', async () => {
    await inTx(async () => {
      expect((await listing('100', '40', '60')).rows).toHaveLength(1);
    });
    await rejects(
      `insert into material_listings (org_id, kind, material_type, total_qty_kg, committed_qty_kg, remaining_qty_kg, price_mode, status)
       values ('${seller}','SALE','RICE_STRAW',100,40,50,'NEGOTIABLE','PUBLISHED')`,
    );
    await rejects(
      `insert into material_listings (org_id, kind, material_type, total_qty_kg, committed_qty_kg, remaining_qty_kg, price_mode, status)
       values ('${seller}','SALE','RICE_STRAW',100,110,-10,'NEGOTIABLE','PUBLISHED')`,
    );
  });

  it('keeps NEGOTIABLE as NULL price and requires price+unit for FIXED', async () => {
    const ins = (mode: string, price: string | null, unit: string | null) =>
      client.query(
        `insert into material_listings (org_id, kind, material_type, total_qty_kg, remaining_qty_kg, price_mode, unit_price_thb, price_unit, status)
         values ($1,'SALE','RICE_STRAW',10,10,$2,$3,$4,'PUBLISHED')`,
        [seller, mode, price, unit],
      );
    await inTx(async () => {
      await ins('NEGOTIABLE', null, null);
      await ins('FIXED', '1.2500', 'KG');
    });
    await rejects(`insert into material_listings (org_id, kind, material_type, total_qty_kg, remaining_qty_kg, price_mode, unit_price_thb, status)
       values ('${seller}','SALE','RICE_STRAW',10,10,'NEGOTIABLE',0,'PUBLISHED')`);
    await rejects(`insert into material_listings (org_id, kind, material_type, total_qty_kg, remaining_qty_kg, price_mode, status)
       values ('${seller}','SALE','RICE_STRAW',10,10,'FIXED','PUBLISHED')`);
  });

  it('requires a source agreement for RESALE and a ready date for pending material', async () => {
    await rejects(`insert into material_listings (org_id, kind, material_type, total_qty_kg, remaining_qty_kg, price_mode, status)
       values ('${seller}','RESALE','RICE_STRAW',10,10,'NEGOTIABLE','PUBLISHED')`);
    await rejects(`insert into material_listings (org_id, kind, material_type, total_qty_kg, remaining_qty_kg, price_mode, pending_material, status)
       values ('${seller}','SALE','RICE_STRAW',10,10,'NEGOTIABLE',true,'PUBLISHED')`);
  });

  it('applies the same balance check to purchase demands', async () => {
    await rejects(`insert into purchase_demands (org_id, accepted_materials, target_qty_kg, committed_qty_kg, remaining_qty_kg, price_mode, status)
       values ('${buyer}', array['RICE_STRAW'], 100, 10, 10, 'NEGOTIABLE', 'PUBLISHED')`);
  });

  it('allows one agreement per offer (UNIQUE offer_id)', async () => {
    await inTx(async () => {
      const { o, l, d } = await chain();
      await client.query('SAVEPOINT s');
      await expect(
        client.query(
          `insert into agreements (kind, offer_id, seller_org_id, buyer_org_id, listing_id, demand_id, qty_kg, status)
           values ('PURCHASE', $1, $2, $3, $4, $5, 10, 'PURCHASE_CONFIRMED')`,
          [o, seller, buyer, l, d],
        ),
      ).rejects.toThrow(/unique|duplicate/i);
    });
  });

  it('caps resale_reserved_kg between 0 and the agreement quantity', async () => {
    await inTx(async () => {
      const { a } = await chain('1000');
      await client.query('SAVEPOINT s');
      await expect(client.query(`update agreements set resale_reserved_kg = 1000.001 where id = $1`, [a])).rejects.toThrow(/resale_cap/);
      await client.query('ROLLBACK TO SAVEPOINT s');
      await expect(client.query(`update agreements set resale_reserved_kg = -1 where id = $1`, [a])).rejects.toThrow(/resale_cap/);
      await client.query('ROLLBACK TO SAVEPOINT s');
      await client.query(`update agreements set resale_reserved_kg = 1000 where id = $1`, [a]);
    });
  });

  it('rejects a BALING_SERVICE agreement with a purchase status', async () => {
    await inTx(async () => {
      const { a } = await chain();
      await expect(client.query(`update agreements set kind = 'BALING_SERVICE' where id = $1`, [a])).rejects.toThrow();
    });
  });

  it('keeps quantity_ledger rows unique and append-only', async () => {
    await inTx(async () => {
      const { a, l } = await chain();
      const ins = `insert into quantity_ledger (subject_type, subject_id, agreement_id, entry_kind, qty_kg) values ('LISTING', $1, $2, 'COMMIT', 10)`;
      await client.query(ins, [l, a]);
      await client.query('SAVEPOINT s');
      await expect(client.query(ins, [l, a])).rejects.toThrow(/unique|duplicate/i);
      await client.query('ROLLBACK TO SAVEPOINT s');
      await expect(client.query(`update quantity_ledger set qty_kg = 1`)).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK TO SAVEPOINT s');
      await expect(client.query(`delete from quantity_ledger`)).rejects.toThrow(/append-only/);
    });
  });

  it('stores images in bytea with a 5 MB limit, sha256 and storage_kind', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const ins = (content: Buffer | null, size: number, hash: string, kind = 'db', key: string | null = null) =>
      client.query(
        `insert into media (org_id, owner_type, owner_id, storage_kind, storage_key, content, content_type, size_bytes, sha256)
         values ($1,'DRAFT',gen_random_uuid(),$2,$3,$4,'image/jpeg',$5,$6) returning storage_kind`,
        [seller, kind, key, content, size, hash],
      );
    await inTx(async () => {
      expect((await ins(bytes, bytes.length, sha)).rows[0].storage_kind).toBe('db');
      const dflt = await client.query(
        `insert into media (org_id, owner_type, owner_id, content, content_type, size_bytes, sha256)
         values ($1,'LISTING',gen_random_uuid(),$2,'image/png',$3,$4) returning storage_kind`,
        [seller, bytes, bytes.length, sha],
      );
      expect(dflt.rows[0].storage_kind).toBe('db');
    });
    const over = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
    await rejects(
      `insert into media (org_id, owner_type, owner_id, content, content_type, size_bytes, sha256)
       values ($1,'DRAFT',gen_random_uuid(),$2,'image/jpeg',$3,$4)`,
      [seller, over, over.length, sha],
    );
    await inTx(async () => {
      const five = Buffer.alloc(5 * 1024 * 1024, 1);
      await ins(five, five.length, sha);
    });
    await rejects(`insert into media (org_id, owner_type, owner_id, content, content_type, size_bytes, sha256)
       values ('${seller}','DRAFT',gen_random_uuid(),'\\x00ff','image/jpeg',2,'not-a-hash')`);
    await rejects(`insert into media (org_id, owner_type, owner_id, content, content_type, size_bytes, sha256)
       values ('${seller}','DRAFT',gen_random_uuid(),'\\x00ff','image/jpeg',99,'${sha}')`); // size mismatch
    await rejects(`insert into media (org_id, owner_type, owner_id, content, content_type, size_bytes, sha256)
       values ('${seller}','DRAFT',gen_random_uuid(),'\\x00ff','image/gif',2,'${sha}')`);
    await rejects(`insert into media (org_id, owner_type, owner_id, storage_kind, content, content_type, size_bytes, sha256)
       values ('${seller}','DRAFT',gen_random_uuid(),'s3','\\x00ff','image/png',2,'${sha}')`); // s3 needs key, no content
    await inTx(async () => {
      await ins(null, 2000, sha, 's3', 'media/x');
    });
  });

  it('rejects out-of-range match routes and scores', async () => {
    const m = (route: number, score: number) =>
      `insert into matches (route, supply_id, demand_id, rule_version, score, tier)
       values (${route}, gen_random_uuid(), gen_random_uuid(), 'v1', ${score}, 0)`;
    await rejects(m(5, 50));
    await rejects(m(1, 100.01));
    await inTx(async () => {
      await client.query(m(4, 100));
    });
  });
});
