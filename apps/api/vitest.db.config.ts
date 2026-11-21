import { defineConfig } from 'vitest/config';

// `npm run test:db`: needs Docker Postgres (TEST_DATABASE_URL). Runs serially with fewer property runs.
export default defineConfig({
  test: {
    include: ['test/**/*.db.test.ts', 'src/**/*.db.test.ts'],
    setupFiles: ['test/setup.db.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    passWithNoTests: true,
  },
});
