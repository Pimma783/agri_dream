// Manual, opt-in smoke test: ONE tiny Converse text call. Never run by npm test.
// Usage (from repo root): node --env-file-if-exists=.env ... is NOT used; this loads .env silently.
//   ENABLE_REAL_BEDROCK=true npx tsx apps/api/scripts/bedrock-smoke.ts --yes
import { existsSync } from 'node:fs';
import path from 'node:path';
import { EnvSchema } from '../src/config/env.js';
import { checkGuards } from '../src/config/guards.js';
import { RealBedrock } from '../src/adapters/bedrock/real.js';

// Load .env without printing values; existing environment variables win.
for (const p of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')]) {
  if (existsSync(p)) { process.loadEnvFile(p); break; }
}

if (!process.argv.includes('--yes')) {
  console.error('Refusing to call AWS without --yes.');
  process.exit(2);
}
if (process.env.ENABLE_REAL_BEDROCK !== 'true') {
  console.error('Refusing: set ENABLE_REAL_BEDROCK=true to run this smoke test.');
  process.exit(2);
}
const env = EnvSchema.parse(process.env);
const problems = checkGuards(env);
if (problems.length > 0) {
  console.error('Config guard failed:', problems.join('; '));
  process.exit(2);
}

// Single attempt: no retry loops for a smoke test.
const port = new RealBedrock({ region: env.AWS_REGION, maxRetries: 0, timeoutMs: 30_000 });
const r = await port.converse(
  {
    modelId: env.BEDROCK_MODEL_ID,
    system: 'ตอบสั้น ๆ',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'ตอบว่า READY' }] }],
    maxTokens: 64,
  },
  AbortSignal.timeout(35_000),
);
console.log(`model:  ${env.BEDROCK_MODEL_ID}`);
console.log(`region: ${env.AWS_REGION}`);
if (r.ok) {
  console.log(`tokens: in=${r.usage.inputTokens} out=${r.usage.outputTokens}`);
  console.log(`reply:  ${r.text.slice(0, 80)}`);
} else {
  console.log(`FAILED: ${r.code} (retryable=${r.retryable})`);
  process.exitCode = 1;
}
