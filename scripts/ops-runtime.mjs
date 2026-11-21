// Local operator helper: loads private configuration without printing or shell-expanding it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = path.join(root, '.env');
if (!existsSync(envPath)) {
  console.error('Private .env is missing. Configure it locally; do not paste secrets into chat.');
  process.exit(1);
}
// Existing environment variables take precedence over the local file.
process.loadEnvFile(envPath);
const mode = process.argv[2];
const commands = {
  'db-up': ['docker', ['compose', '--env-file', envPath, '-f', 'docker-compose.yml', '-f', '.env.runtime.compose.yml', 'up', '-d', 'postgres']],
  'db-status': ['docker', ['exec', 'agrimatch-postgres', 'pg_isready', '-U', 'agrimatch', '-d', 'agrimatch']],
  migrate: ['npm', ['run', 'migrate', '--workspace', 'apps/api', '--', 'up', '--no-verbose']],
  'test-db': ['npm', ['run', 'test:db']],
  api: ['npm', ['run', 'dev:api']],
  web: ['npm', ['run', 'dev:web']],
  worker: ['npm', ['run', 'dev:worker', '--workspace', 'apps/api']],
};
if (!(mode in commands)) {
  console.error(`Usage: node scripts/ops-runtime.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
if (mode === 'test-db') {
  let valid = false;
  try {
    const url = new URL(process.env.TEST_DATABASE_URL ?? '');
    valid = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.endsWith('_test');
  } catch { /* Fail closed without echoing the URL. */ }
  if (!valid) {
    console.error('DB tests require an explicit local TEST_DATABASE_URL ending in _test.');
    process.exit(1);
  }
}
const [command, args] = commands[mode];
const child = spawn(command, args, { cwd: root, env: process.env, stdio: 'inherit', shell: false });
child.on('error', () => {
  console.error(`Unable to start ${mode}; check that ${command} is installed.`);
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
