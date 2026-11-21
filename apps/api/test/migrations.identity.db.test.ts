import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runner } from './db-helper.js';

const url = process.env.TEST_DATABASE_URL;
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');
const base = { databaseUrl: url as string, dir, migrationsTable: 'pgmigrations', log: () => {} };

describe.skipIf(!url)('identity and auth migrations (real Postgres)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    await runner({ ...base, direction: 'down', count: Infinity }); // from scratch
    await runner({ ...base, direction: 'up' });
    client = new pg.Client({ connectionString: url });
    await client.connect();
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

  it('creates the six identity tables', async () => {
    const { rows } = await client.query(
      `select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`,
      [['organizations', 'users', 'memberships', 'sessions', 'line_identities', 'line_link_codes']],
    );
    expect(rows).toHaveLength(6);
  });

  it('rejects an organization with only one coordinate', async () => {
    await rejects(`insert into organizations (kind, name, lat) values ('FARMER', 'x', 10)`);
  });

  it('rejects a LINKED line identity without user and org', async () => {
    await rejects(
      `insert into line_identities (channel, line_user_id, status) values ('farmer', 'Utest', 'LINKED')`,
    );
  });

  it('rejects a session token that is not a sha256 hex hash', async () => {
    await rejects(
      `insert into sessions (token_hash, user_id, csrf_secret, expires_at)
       values ('plain-token', gen_random_uuid(), repeat('a', 32), now() + interval '1 day')`,
    );
  });

  it('rejects a link code that is not a sha256 hex hash', async () => {
    await rejects(
      `insert into line_link_codes (code_hash, org_id, user_id, channel, expires_at)
       values ('ABCD2345', gen_random_uuid(), gen_random_uuid(), 'farmer', now() + interval '1 day')`,
    );
  });

  it('treats emails as case-insensitive unique', async () => {
    await client.query('BEGIN');
    try {
      await client.query(`insert into users (email, display_name) values ('A@Example.test', 'a')`);
      await expect(
        client.query(`insert into users (email, display_name) values ('a@example.test', 'b')`),
      ).rejects.toThrow();
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
