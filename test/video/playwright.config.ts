import { join, resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

// Demo recording: the e2e stack seeded from demo/recording.config.json, one continuous browser recording.
// Run `npm run record:demo`; scripts/cut-demo.mjs then cuts the scenes and burns the captions.
process.env.BIFROST_METER_SEED_CONFIG ??= join(resolve(__dirname, '../..'), 'demo/recording.config.json');

export default defineConfig({
  testDir: '.',
  testMatch: '*.video.ts',
  globalSetup: '../e2e/stack.ts',
  workers: 1,
  retries: 0,
  timeout: 540_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: { browserName: 'chromium', headless: true, trace: 'off', screenshot: 'off', video: 'off' },
});
