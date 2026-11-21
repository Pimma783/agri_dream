import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

describe('test tooling', () => {
  it('uses at least 100 fast-check runs by default', () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(100);
  });

  it('runs a property for the configured number of runs', () => {
    let runs = 0;
    fc.assert(fc.property(fc.integer(), (n) => { runs += 1; return n + 0 === n; }));
    expect(runs).toBeGreaterThanOrEqual(100);
  });
});
