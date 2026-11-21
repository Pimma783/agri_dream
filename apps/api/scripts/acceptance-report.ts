// Acceptance report (task 21.1, Requirements 18.5 and 18.6). Run: `npm run acceptance:report --workspace apps/api [-- <base-url>]`.
//
// Prints, without any secret value:
//   - adapter kinds, from <base-url>/healthz when a URL (or ACCEPTANCE_BASE_URL) is given, otherwise from this process's env;
//   - the non-secret flags of this process's env (booleans, region and model ID only);
//   - each item of docs/AGRIMATCH_MVP_SPEC.md section 17 as `PASS (real)`, `PASS (mock)` or `NOT DONE`,
//     with the automated test files and spec tasks behind it;
//   - cut or unfinished tasks and what has NOT been verified against real LINE or AWS.
// Rules: an item is NOT DONE when a mapped test file is missing or a mapped task is not marked [x] in tasks.md.
// It is `PASS (real)` only when every adapter it needs reports kind 'real' AND its id is listed in ACCEPTANCE_REAL_EVIDENCE
// (a comma list set by a person who ran it against the real service). Otherwise a pass is `PASS (mock)`.
// Automated tests use fakes and a local Postgres, so they alone never produce `PASS (real)`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { adapterKinds, type AdapterKind, type AdapterKinds } from '../src/adapters/kinds.js';
import { EnvSchema, resolveAiMode } from '../src/config/env.js';

export type Verdict = 'PASS (real)' | 'PASS (mock)' | 'NOT DONE';
type Adapter = keyof AdapterKinds;
export interface ChecklistItem {
  id: number;
  title: string;
  tests: readonly string[];
  tasks: readonly string[];
  adapters: readonly Adapter[];
}
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const testDir = path.resolve(here, '../test');
const tasksPath = path.join(repoRoot, '.kiro/specs/agrimatch-mvp/tasks.md');

export const CHECKLIST: readonly ChecklistItem[] = [
  { id: 1, title: '3 OA use role-correct data and conversation; no wrong-account message',
    tests: ['line-gateway.test.ts', 'line-identity.db.test.ts', 'webhook.db.test.ts', 'line-farmer-handler.db.test.ts'], tasks: ['9.3', '9.8', '9.10'], adapters: ['line'] },
  { id: 2, title: 'Farmer lists through LINE until a factory can accept, without the website',
    tests: ['e2e-story1.db.test.ts', 'line-farmer-handler.db.test.ts'], tasks: ['9.8', '14.2'], adapters: ['line'] },
  { id: 3, title: 'Both factory types set demand through the Dashboard and LINE',
    tests: ['resource-routes.db.test.ts', 'drafts.db.test.ts'], tasks: ['6.5', '11.3', '18.1'], adapters: ['line'] },
  { id: 4, title: 'Baler separates purchase postings from baling services',
    tests: ['baling-story.db.test.ts', 'resource-routes.db.test.ts'], tasks: ['6.2', '12.1'], adapters: [] },
  { id: 5, title: 'AI asks for missing data; user reviews every draft before publishing',
    tests: ['assistant-orchestrator.db.test.ts', 'assistant-step-form.db.test.ts', 'drafts-publish.props.db.test.ts'], tasks: ['10.2', '10.5'], adapters: ['bedrock'] },
  { id: 6, title: 'AI answers and edits drafts on LINE and Dashboard within the user\'s permissions',
    tests: ['assistant-authority.props.db.test.ts', 'assistant-tools.test.ts'], tasks: ['10.2', '20.2'], adapters: ['bedrock', 'line'] },
  { id: 7, title: 'Baling confirmation changes no ownership and creates no purchased stock',
    tests: ['baling-story.db.test.ts'], tasks: ['12.1'], adapters: [] },
  { id: 8, title: 'Matching never invents a plant, price, coordinate or quality; shows unknowns',
    tests: ['matching-missing.props.test.ts', 'matching-filter.props.test.ts', 'matches-visibility.test.ts'], tasks: ['3.5', '7.3'], adapters: [] },
  { id: 9, title: 'Accepted offer: both sides see one agreement and the remaining quantity is right',
    tests: ['accept.db.test.ts', 'offers.db.test.ts', 'quantity-conservation.props.db.test.ts'], tasks: ['8.2', '8.3'], adapters: [] },
  { id: 10, title: 'Simultaneous accepts or repeated webhooks never oversell or duplicate an agreement',
    tests: ['accept-concurrency.db.test.ts', 'accept-idempotence.props.db.test.ts', 'webhook-dedup.props.db.test.ts'], tasks: ['8.4', '8.5', '9.5'], adapters: [] },
  { id: 11, title: 'Baler can draft a resale from a confirmed purchase; it never publishes itself',
    tests: ['resale-draft.db.test.ts', 'e2e-story3.db.test.ts'], tasks: ['16.1', '16.5'], adapters: [] },
  { id: 12, title: 'Resale stays within source quantity; no automatic claim of receipt or baling; no copied image quality',
    tests: ['resale-draft.db.test.ts', 'resale-publish.db.test.ts'], tasks: ['16.1', '16.2'], adapters: [] },
  { id: 13, title: 'Resale to a downstream factory is a new, traceable agreement',
    tests: ['resale-publish.db.test.ts', 'e2e-story3.db.test.ts'], tasks: ['16.3', '16.5'], adapters: [] },
  { id: 14, title: 'Real image assessment in at least one case; bad image or AI failure still lists',
    tests: ['assessment.db.test.ts', 'image-assessment.test.ts', 'media.db.test.ts'], tasks: ['13.2', '13.3'], adapters: ['bedrock', 'media'] },
  { id: 15, title: 'Wrong webhook signature, wrong organization and stale-version confirm are rejected',
    tests: ['line-gateway.test.ts', 'webhook.db.test.ts', 'permissions.db.test.ts', 'drafts.db.test.ts'], tasks: ['6.4', '9.3', '9.4'], adapters: [] },
  { id: 16, title: 'Failed notification leaves transaction state correct and viewable later',
    tests: ['jobs.db.test.ts', 'accept.db.test.ts'], tasks: ['8.2', '9.1'], adapters: ['line'] },
  { id: 17, title: 'A listing with no image or a failed assessment still enters the sale process',
    tests: ['assessment.db.test.ts', 'e2e-story1.db.test.ts'], tasks: ['13.2', '14.2'], adapters: ['media'] },
];

/** Reads task status marks from tasks.md: `x` done, `-` in progress, `~` queued, ` ` open. */
export function readTaskMarks(text: string): Map<string, string> {
  const marks = new Map<string, string>();
  for (const m of text.matchAll(/^\s*- \[([ x~-])\] (\d+(?:\.\d+)?)[. ]/gm)) marks.set(m[2]!, m[1]!);
  return marks;
}
export function evaluate(
  item: ChecklistItem,
  ctx: { marks: Map<string, string>; kinds: AdapterKinds | null; evidence: ReadonlySet<number>; testExists: (f: string) => boolean },
): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  for (const f of item.tests) if (!ctx.testExists(f)) reasons.push(`missing test ${f}`);
  for (const t of item.tasks) if (ctx.marks.get(t) !== 'x') reasons.push(`task ${t} not complete`);
  if (reasons.length) return { verdict: 'NOT DONE', reasons };
  const real = item.adapters.length > 0 && ctx.kinds !== null && item.adapters.every((a) => ctx.kinds![a] === 'real') && ctx.evidence.has(item.id);
  return { verdict: real ? 'PASS (real)' : 'PASS (mock)', reasons };
}
export function cutTasks(text: string): string[] {
  const out: string[] = [];
  let top = '';
  for (const line of text.split('\n')) {
    const m = line.match(/^- \[([ x~-])\] (\d+)\. (.*)$/);
    if (m) { top = m[2]!; continue; }
    const s = line.match(/^\s+- \[([ ~-])\] (\d+\.\d+) (.*)$/);
    if (s && Number(top) >= 16 && Number(top) <= 20) out.push(`${s[2]} ${s[3]}`);
  }
  return out;
}
async function remoteKinds(base: string): Promise<AdapterKinds | null> {
  try {
    const res = await fetch(new URL('/healthz', base), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { adapters?: Partial<Record<Adapter, unknown>> };
    const pick = (v: unknown): AdapterKind => (v === 'real' ? 'real' : 'mock');
    return { line: pick(body.adapters?.line), bedrock: pick(body.adapters?.bedrock), media: pick(body.adapters?.media) };
  } catch {
    return null;
  }
}
async function main(): Promise<void> {
  const base = process.argv.slice(2).find((a) => a.startsWith('http')) ?? process.env.ACCEPTANCE_BASE_URL;
  const parsed = EnvSchema.safeParse(process.env);
  const env = parsed.success ? parsed.data : null;
  let kinds: AdapterKinds | null = null;
  let source = 'unavailable';
  if (base) {
    kinds = await remoteKinds(base);
    source = kinds ? `${new URL(base).origin}/healthz` : `${new URL(base).origin}/healthz (unreachable)`;
  } else if (env) {
    kinds = adapterKinds(env);
    source = 'local process env';
  }
  console.log('Acceptance report (no secrets printed)');
  console.log(`Adapter kinds from ${source}:`);
  console.log(kinds ? `  line=${kinds.line} bedrock=${kinds.bedrock} media=${kinds.media}` : '  unknown (treated as mock)');
  console.log('Flags in this process env (not the hosted env):');
  if (env) {
    console.log(`  NODE_ENV=${env.NODE_ENV} ENABLE_REAL_LINE=${env.ENABLE_REAL_LINE} ENABLE_REAL_BEDROCK=${env.ENABLE_REAL_BEDROCK}`
      + ` VISION_ENABLED=${env.VISION_ENABLED} AI_MODE=${resolveAiMode(env)} AWS_REGION=${env.AWS_REGION} BEDROCK_MODEL_ID=${env.BEDROCK_MODEL_ID}`);
  } else {
    console.log('  env did not validate; flags withheld');
  }
  const taskText = existsSync(tasksPath) ? readFileSync(tasksPath, 'utf8') : '';
  const marks = readTaskMarks(taskText);
  if (!taskText) console.log('  tasks.md not found; every item is reported NOT DONE');
  const evidence = new Set((process.env.ACCEPTANCE_REAL_EVIDENCE ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0));
  console.log('\nChecklist (docs/AGRIMATCH_MVP_SPEC.md section 17):');
  const tally: Record<Verdict, number> = { 'PASS (real)': 0, 'PASS (mock)': 0, 'NOT DONE': 0 };
  for (const item of CHECKLIST) {
    const r = evaluate(item, { marks, kinds, evidence, testExists: (f) => existsSync(path.join(testDir, f)) });
    tally[r.verdict]++;
    console.log(`${String(item.id).padStart(2)}. ${r.verdict.padEnd(12)} ${item.title}`);
    console.log(`      tests: ${item.tests.join(', ')}`);
    console.log(`      tasks: ${item.tasks.join(', ')}; adapters: ${item.adapters.join(', ') || 'none'}`);
    for (const why of r.reasons) console.log(`      reason: ${why}`);
  }
  console.log(`\nTotals: PASS (real)=${tally['PASS (real)']} PASS (mock)=${tally['PASS (mock)']} NOT DONE=${tally['NOT DONE']}`);
  const cut = cutTasks(taskText);
  console.log(`\nCut or unfinished tasks in 16 to 20 (${cut.length}):`);
  for (const c of cut) console.log(`  - ${c}`);
  console.log('\nNOT verified against real LINE or AWS (PASS (mock) means fakes and local Postgres only):');
  for (const line of [
    'LINE end to end: no real message sent or received; hosted worker is at 0 and "Use webhook" is off for all 3 channels',
    'Webhook signature check against LINE-signed traffic (only locally signed test requests)',
    'Real Bedrock chat and image assessment (hosted AI_MODE=disabled, VISION_ENABLED=false)',
    'Media storage in S3 (images are stored in PostgreSQL; the S3 file is for review only)',
    'Failed real notification delivery and retry behaviour',
    'Hosted login, /api/me and /api/matches are checked by the deploy smoke test, not by the automated tests',
  ]) console.log(`  - ${line}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : 'acceptance report failed');
    process.exitCode = 1;
  });
}
