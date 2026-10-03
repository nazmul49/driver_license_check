import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { API_PORT, BASE_URL, fixturesDir, repoRoot, serverEnv } from './e2e/env';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    permissions: ['camera'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${path.join(fixturesDir, 'card.mjpeg')}`,
      ],
    },
  },
  projects: [
    {
      // Mobile first: a phone viewport with touch, on Chromium (fake camera flags are Chromium only).
      name: 'chromium',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
  ],
  webServer: {
    // The API runs with NODE_ENV=development (no Secure cookie over http); the page is still
    // built for production so the suite tests the bundle that ships.
    command: 'NODE_ENV=production npm run build -w hosted-page && npx tsx server/src/main.ts',
    cwd: repoRoot,
    env: serverEnv,
    url: `http://127.0.0.1:${API_PORT}/v1/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
