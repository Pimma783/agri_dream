import { defineConfig } from 'vitest/config';

// `npm test`: pure and unit tests. Database tests (*.db.test.ts) run with `npm run test:db`.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/*.db.test.ts', '**/node_modules/**', '**/dist/**'],
    setupFiles: ['test/setup.ts'],
    environment: 'node',
  },
});
