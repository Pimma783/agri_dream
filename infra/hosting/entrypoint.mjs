import { spawn } from 'node:child_process';

const mode = process.argv[2] ?? 'app';
const specs = {
  app: [
    ['node', ['dist/server.js'], '/app/apps/api', { PORT: '4000' }],
    ['node', ['../../node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', '3000'], '/app/apps/web', {}],
    ['nginx', ['-g', 'daemon off;'], '/app', {}],
  ],
  worker: [['node', ['dist/worker.js'], '/app/apps/api', {}]],
  migrate: [['node', ['/app/infra/hosting/migrate.mjs'], '/app', {}]],
  verify: [['node', ['/app/infra/hosting/verify.mjs'], '/app', {}]],
  // One-off demo seed as the restricted app role. tsx is installed in the image (the build stage keeps devDependencies).
  seed: [['node', ['../../node_modules/tsx/dist/cli.mjs', 'scripts/seed-demo.ts', '--recompute'], '/app/apps/api', {}]],
};
if (!(mode in specs)) {
  console.error('Expected app, worker, migrate, verify, or seed.');
  process.exit(1);
}
let stopping = false;
const children = specs[mode].map(([command, args, cwd, extraEnv]) =>
  spawn(command, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: 'inherit', shell: false }));
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  const force = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
    process.exit(code);
  }, 25_000);
  force.unref();
  Promise.all(children.map(child => child.exitCode !== null ? undefined : new Promise(resolve => child.once('exit', resolve))))
    .then(() => process.exit(code));
}
for (const child of children) {
  child.on('error', () => { console.error(`Failed to start ${mode} process.`); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
