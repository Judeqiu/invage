import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    // .worktrees holds full repo copies — running their tests in parallel
    // double-applies Postgres migrations (deadlocks) and tests stale code.
    exclude: ['**/node_modules/**', '**/.worktrees/**', 'tests/migration/**'],
    fileParallelism: false,
    hookTimeout: 30000,
  },
});
