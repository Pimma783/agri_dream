import { spawn } from 'node:child_process';
import pg from 'pg';

const child = spawn('npm', ['run', 'migrate', '--workspace', 'apps/api', '--', 'up', '--no-verbose'],
  { cwd: '/app', env: process.env, stdio: 'inherit', shell: false });
child.on('error', () => { console.error('Unable to start migrations.'); process.exit(1); });
const code = await new Promise(resolve => child.on('exit', resolve));
if (code !== 0) process.exit(code ?? 1);
if (!process.env.APP_DATABASE_PASSWORD) {
  console.error('Missing runtime database credential; value withheld.');
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'agrimatch_app'");
  if (!exists.rowCount) {
    const formatted = await client.query("SELECT format('CREATE ROLE agrimatch_app LOGIN PASSWORD %L', $1::text) AS sql", [process.env.APP_DATABASE_PASSWORD]);
    await client.query(formatted.rows[0].sql);
  }
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query('GRANT CONNECT ON DATABASE agrimatch TO agrimatch_app');
  await client.query('GRANT USAGE ON SCHEMA public TO agrimatch_app');
  await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agrimatch_app');
  await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agrimatch_app');
  await client.query('REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, quantity_ledger FROM agrimatch_app');
  await client.query('REVOKE ALL ON pgmigrations FROM agrimatch_app');
  console.log('Migrations complete; restricted runtime database role configured.');
} catch (error) {
  console.error(`Database setup failed (${error.code ?? 'UNKNOWN'}); details withheld.`);
  process.exitCode = 1;
} finally {
  await client.end();
}
