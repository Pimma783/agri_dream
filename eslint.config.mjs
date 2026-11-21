// Flat ESLint config. Enforces the layering in .kiro/specs/agrimatch-mvp/design.md ("Module boundaries").
// One config block per layer: ESLint replaces (not merges) a rule when a later block sets it for the same file.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const layer = (name) => [`**/${name}`, `**/${name}/**`];

const NODE_IO = [
  'fs', 'fs/promises', 'net', 'http', 'https', 'http2', 'dgram', 'tls', 'child_process',
  'worker_threads', 'cluster', 'dns', 'dns/promises',
].flatMap((m) => [m, `node:${m}`]);

const IO_LIBS = ['pg', 'pg/*', 'express', 'pino', '@aws-sdk/*', 'node-pg-migrate'];

// Layers that may never be imported by the pure layers or by lower layers.
const group = (name, layers, message) => ({ group: layers.flatMap(layer), message: `${name}: ${message}` });

const authorizeOnlyInServices = {
  group: ['**/domain/permissions', '**/domain/permissions/**', '**/domain/permissions.js'],
  importNames: ['authorize'],
  message: 'Only services/ may call authorize(). Call a service instead.',
};
const transactionsOnlyInServices = {
  group: ['**/repos/tx', '**/repos/tx.js', '**/repos/transaction', '**/repos/transaction.js', '**/repos'],
  importNames: ['withTransaction'],
  message: 'Only services/ may open transactions (withTransaction).',
};

const restrict = (patterns, paths = []) => ({
  'no-restricted-imports': ['error', { paths, patterns }],
});

const pureRules = {
  ...restrict(
    [group('pure layer', ['repos', 'adapters', 'http', 'services', 'channels', 'jobs', 'assistant', 'config'],
      'matching/ and domain/ must stay pure and may not import this layer.')],
    [...NODE_IO, ...IO_LIBS].map((name) => ({ name, message: 'matching/ and domain/ must not do I/O.' })),
  ),
  'no-restricted-properties': ['error',
    { object: 'Date', property: 'now', message: 'No Date.now() in pure code. Pass the time in as an argument.' },
    { object: 'Math', property: 'random', message: 'No Math.random() in pure code. Pass randomness in.' },
  ],
  'no-restricted-syntax': ['error',
    { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'No new Date() without arguments in pure code. Pass the time in.' },
    { selector: "CallExpression[callee.name='require']", message: 'No require() in pure code.' },
    { selector: "ImportExpression", message: 'No dynamic import() in pure code.' },
  ],
  'no-restricted-globals': ['error',
    { name: 'process', message: 'No process access in pure code.' },
    { name: 'fetch', message: 'No network access in pure code.' },
  ],
};

const noRepos = (layers) => ({
  ...restrict(
    [group('layering', ['repos', ...layers], 'call a service, not this layer.'), authorizeOnlyInServices, transactionsOnlyInServices],
    [{ name: 'pg', message: 'Only repos/ talks to Postgres.' }, { name: 'pg/*', message: 'Only repos/ talks to Postgres.' }],
  ),
});

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '.venv/**', 'web/**', 'docs/**', 'tests/**', 'infra/**', '**/*.tsbuildinfo', '**/next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
  { files: ['apps/web/**/*.{ts,tsx}'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },

  // Pure layers
  { files: ['apps/api/src/matching/**/*.ts', 'apps/api/src/domain/**/*.ts'], rules: pureRules },

  // services: the only layer allowed to use repos, authorize() and transactions. Must not depend on entry layers.
  {
    files: ['apps/api/src/services/**/*.ts'],
    rules: restrict([group('services', ['http', 'channels', 'assistant', 'jobs'], 'services/ sit below this layer.')],
      [{ name: 'express', message: 'services/ must not depend on HTTP.' }]),
  },

  // entry layers call services, never repos
  { files: ['apps/api/src/http/**/*.ts'], rules: noRepos([]) },
  { files: ['apps/api/src/channels/**/*.ts'], rules: noRepos(['http']) },
  { files: ['apps/api/src/assistant/**/*.ts'], rules: noRepos(['http', 'channels']) },
  { files: ['apps/api/src/jobs/**/*.ts'], rules: noRepos(['http']) },

  // lower layers must not reach up
  {
    files: ['apps/api/src/repos/**/*.ts'],
    rules: restrict([group('repos', ['services', 'http', 'channels', 'assistant', 'jobs', 'adapters', 'matching'], 'repos/ sit below this layer.'), authorizeOnlyInServices]),
  },
  {
    files: ['apps/api/src/adapters/**/*.ts'],
    rules: restrict([group('adapters', ['repos', 'services', 'http', 'channels', 'assistant', 'jobs'], 'adapters/ sit below this layer.'), authorizeOnlyInServices]),
  },
);
