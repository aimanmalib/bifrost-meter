import { defineConfig } from 'vitest/config';

// Contract tests against the pinned gateway image (demo/docker-compose.yml). Run with `npm run test:contract`.
// Without Docker the suite is skipped with a clear message instead of failing.
export default defineConfig({
  test: {
    root: new URL('../..', import.meta.url).pathname,
    include: ['test/contract/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/contract/stack.ts'],
    reporters: ['verbose'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
