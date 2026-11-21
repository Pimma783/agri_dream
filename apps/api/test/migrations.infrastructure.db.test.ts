import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runner } from './db-helper.js';
const url = process.env.TEST_DATABASE_URL;
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');
const base = { databaseUrl: url as string, dir, migrationsTable: 'pgmigrations', log: () => {} };
describe.skipIf(!url)('infrastructure-table migrations (real Postgres)', () => {
  let client: pg.Client;
  beforeAll(async () => {
    await runner({ ...base, direction: 'down', count: Infinity });
    await runner({ ...base, direction: 'up' });
    client = new pg.Client({ connectionString: url });
    await client.connect();
  });
  afterAll(async () => {
    await client?.end();
  });
  const rejects = async (sql: string, params: unknown[], pattern: RegExp) => {
    await client.query('BEGIN');
    try {
      await expect(client.query(sql, params)).rejects.toThrow(pattern);
    } finally {
      await client.query('ROLLBACK');
    }
  };
  const lineIdentity = async () =>
    (
      await client.query(
        `insert into line_identities (channel, line_user_id, status) values ('farmer', 'Utest-' || gen_random_uuid(), 'UNLINKED') returning id`,
      )
    ).rows[0].id as string;

  it('creates the tables with no float columns', async () => {
    const names = ['webhook_events', 'jobs', 'notification_outbox', 'audit_logs'];
    const t = await client.query(
      `select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`,
      [names],
    );
    expect(t.rows).toHaveLength(names.length);
    const f = await client.query(
      `select 1 from information_schema.columns where table_schema='public' and table_name = any($1) and data_type in ('real','double precision')`,
      [names],
    );
    expect(f.rows).toHaveLength(0);
  });

  it('rejects a duplicate webhook (channel, event_id) and allows the same id on another channel', async () => {
    const ins = `insert into webhook_events (channel, event_id, payload) values ($1, $2, '{}')`;
    await client.query(ins, ['farmer', 'evt-1']);
    await client.query(ins, ['baler', 'evt-1']);
    await rejects(ins, ['farmer', 'evt-1'], /unique|duplicate/i);
    const r = await client.query(
      `insert into webhook_events (channel, event_id, payload) values ('farmer','evt-1','{}') on conflict (channel, event_id) do nothing returning id`,
    );
    expect(r.rowCount).toBe(0);
  });

  it('enforces jobs dedupe_key, status and attempts limits', async () => {
    const ins = `insert into jobs (kind, payload, dedupe_key) values ('line_event', '{}', $1)`;
    await client.query(ins, ['farmer:evt-1']);
    await rejects(ins, ['farmer:evt-1'], /unique|duplicate/i);
    await client.query(ins, [null]);
    await client.query(ins, [null]); // NULL keys never collide
    await rejects(`insert into jobs (kind, payload, status) values ('k','{}','BOGUS')`, [], /check/i);
    await rejects(`insert into jobs (kind, payload, max_attempts) values ('k','{}',0)`, [], /check/i);
    await rejects(`insert into jobs (kind, payload, attempts, max_attempts) values ('k','{}',6,5)`, [], /check/i);
  });

  it('enforces outbox dedupe_key, status, FK and sent_at shape', async () => {
    const id = await lineIdentity();
    const ins = `insert into notification_outbox (channel, to_line_identity_id, message, dedupe_key) values ('farmer', $1, '{}', $2)`;
    await client.query(ins, [id, 'agreement:1:created:a']);
    await rejects(ins, [id, 'agreement:1:created:a'], /unique|duplicate/i);
    await rejects(ins, ['00000000-0000-0000-0000-000000000000', 'k2'], /foreign key/i);
    await rejects(
      `insert into notification_outbox (channel, to_line_identity_id, message, status, dedupe_key) values ('farmer',$1,'{}','BOGUS','k3')`,
      [id],
      /check/i,
    );
    await rejects(
      `insert into notification_outbox (channel, to_line_identity_id, message, status, dedupe_key) values ('farmer',$1,'{}','SENT','k4')`,
      [id],
      /check/i,
    );
    const ok = await client.query(
      `insert into notification_outbox (channel, to_line_identity_id, message, status, sent_at, dedupe_key) values ('farmer',$1,'{}','SENT',now(),'k5') returning retry_key`,
      [id],
    );
    expect(ok.rows[0].retry_key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps audit_logs append-only: update, delete and truncate are rejected', async () => {
    await client.query(`insert into audit_logs (channel, action, entity_type, detail) values ('system', 'test.created', 'thing', '{"a":1}')`);
    await rejects(`update audit_logs set action = 'tampered'`, [], /append-only/);
    await rejects(`delete from audit_logs`, [], /append-only/);
    await rejects(`truncate audit_logs`, [], /append-only/);
    await rejects(`insert into audit_logs (channel, action, entity_type) values ('fax','a','t')`, [], /check/i);
    const n = await client.query(`select count(*)::int as n from audit_logs where action = 'test.created'`);
    expect(n.rows[0].n).toBe(1);
  });

  it('revokes UPDATE/DELETE/TRUNCATE on audit_logs from PUBLIC', async () => {
    const r = await client.query(
      `select privilege_type from information_schema.role_table_grants
       where table_name = 'audit_logs' and grantee = 'PUBLIC' and privilege_type in ('UPDATE','DELETE','TRUNCATE')`,
    );
    expect(r.rows).toHaveLength(0);
  });
});
