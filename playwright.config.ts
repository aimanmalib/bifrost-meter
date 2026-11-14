import { defineConfig } from '@playwright/test';

// End-to-end suite: the packaged extension in code-server against the pinned gateway (test/e2e). Run `npm run test:e2e`.
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '*.e2e.ts',
  globalSetup: './test/e2e/stack.ts',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { browserName: 'chromium', headless: true, trace: 'off', screenshot: 'off', video: 'off' },
});
