import fc from 'fast-check';

// Pure properties run at least 100 times. Individual tests may raise this, not lower it.
export const PURE_NUM_RUNS = 100;
fc.configureGlobal({ numRuns: PURE_NUM_RUNS });
