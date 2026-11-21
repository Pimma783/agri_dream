import { describe, expect, it } from 'vitest';
import { CHECKLIST, cutTasks, evaluate, readTaskMarks } from '../scripts/acceptance-report.js';

const item = { id: 99, title: 't', tests: ['a.test.ts'], tasks: ['1.1'], adapters: ['line'] } as const;
const base = { marks: new Map([['1.1', 'x']]), testExists: () => true };

describe('acceptance report', () => {
  it('never reports a mock adapter as real, even with evidence', () => {
    const mock = { line: 'mock', bedrock: 'mock', media: 'real' } as const;
    expect(evaluate(item, { ...base, kinds: mock, evidence: new Set([99]) }).verdict).toBe('PASS (mock)');
  });
  it('needs a real adapter and recorded evidence for PASS (real)', () => {
    const real = { line: 'real', bedrock: 'mock', media: 'real' } as const;
    expect(evaluate(item, { ...base, kinds: real, evidence: new Set() }).verdict).toBe('PASS (mock)');
    expect(evaluate(item, { ...base, kinds: real, evidence: new Set([99]) }).verdict).toBe('PASS (real)');
  });
  it('is NOT DONE when a task is open or a test file is missing', () => {
    const kinds = { line: 'mock', bedrock: 'mock', media: 'real' } as const;
    expect(evaluate(item, { ...base, marks: new Map([['1.1', '~']]), kinds, evidence: new Set() }).verdict).toBe('NOT DONE');
    expect(evaluate(item, { ...base, testExists: () => false, kinds, evidence: new Set() }).verdict).toBe('NOT DONE');
  });
  it('parses task marks and lists open tasks of 16 to 20 only', () => {
    const text = '- [ ] 16. A\n  - [x] 16.1 done\n  - [~] 16.2 open [P0]\n- [ ] 21. B\n  - [~] 21.2 later\n';
    expect(readTaskMarks(text).get('16.2')).toBe('~');
    expect(cutTasks(text)).toEqual(['16.2 open [P0]']);
  });
  it('covers all 17 checklist items', () => {
    expect(CHECKLIST.map((c) => c.id)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  });
});
