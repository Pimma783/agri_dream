import fc from 'fast-check';

// [DB] properties use fewer runs because each run hits Postgres.
export const DB_NUM_RUNS = 25;
fc.configureGlobal({ numRuns: DB_NUM_RUNS });
