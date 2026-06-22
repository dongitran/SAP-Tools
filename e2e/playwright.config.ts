import { defineConfig } from '@playwright/test';

const isCi = process.env['CI'] === 'true';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  failOnFlakyTests: isCi,
  forbidOnly: true,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 180000,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
