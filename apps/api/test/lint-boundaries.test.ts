import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, 'eslint.config.mjs') });

async function ruleIds(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, 'apps/api/src', file) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

const bad: Array<[string, string, string]> = [
  ['domain imports repos', 'domain/x.ts', "import { q } from '../repos/index.js';\nexport const a = q;\n"],
  ['matching imports adapters', 'matching/x.ts', "import { k } from '../adapters/kinds.js';\nexport const a = k;\n"],
  ['matching imports http', 'matching/x.ts', "import { createApp } from '../http/app.js';\nexport const a = createApp;\n"],
  ['matching imports services', 'matching/x.ts', "import { s } from '../services/index.js';\nexport const a = s;\n"],
  ['domain imports node:fs', 'domain/x.ts', "import { readFileSync } from 'node:fs';\nexport const a = readFileSync;\n"],
  ['domain imports node:net', 'domain/x.ts', "import net from 'node:net';\nexport const a = net;\n"],
  ['matching uses Date.now', 'matching/x.ts', 'export const a = Date.now();\n'],
  ['domain uses new Date()', 'domain/x.ts', 'export const a = new Date();\n'],
  ['http imports repos', 'http/x.ts', "import { r } from '../repos/index.js';\nexport const a = r;\n"],
  ['channels imports repos', 'channels/x.ts', "import { r } from '../repos/index.js';\nexport const a = r;\n"],
  ['assistant imports repos', 'assistant/x.ts', "import { r } from '../repos/index.js';\nexport const a = r;\n"],
  ['http calls authorize', 'http/x.ts', "import { authorize } from '../domain/permissions.js';\nexport const a = authorize;\n"],
  ['http opens transactions', 'http/x.ts', "import { withTransaction } from '../repos/tx.js';\nexport const a = withTransaction;\n"],
  ['repos import services', 'repos/x.ts', "import { s } from '../services/index.js';\nexport const a = s;\n"],
];

const good: Array<[string, string, string]> = [
  ['http imports services', 'http/x.ts', "import { s } from '../services/index.js';\nexport const a = s;\n"],
  ['services import repos and authorize', 'services/x.ts',
    "import { r } from '../repos/index.js';\nimport { authorize } from '../domain/permissions.js';\nexport const a = [r, authorize];\n"],
  ['domain imports matching-free code and uses a passed-in clock', 'domain/x.ts',
    'export const a = (now: Date) => now.getTime();\n'],
  ['matching imports domain', 'matching/x.ts', "import { d } from '../domain/index.js';\nexport const a = d;\n"],
];

describe('layering lint rules', () => {
  it.each(bad)('flags: %s', async (_name, file, code) => {
    const ids = await ruleIds(file, code);
    expect(ids.some((id) => id.startsWith('no-restricted-'))).toBe(true);
  });

  it.each(good)('allows: %s', async (_name, file, code) => {
    const ids = await ruleIds(file, code);
    expect(ids.filter((id) => id.startsWith('no-restricted-'))).toEqual([]);
  });
});
