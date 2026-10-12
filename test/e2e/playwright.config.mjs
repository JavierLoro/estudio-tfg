import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  globalTimeout: 10 * 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    locale: 'es-ES',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
