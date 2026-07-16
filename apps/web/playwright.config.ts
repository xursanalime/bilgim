import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e config for `apps/web` (Task: best-effort e2e setup).
 *
 * Status: infra-readiness only. This repo/sandbox may not have internet
 * access or the system deps needed to install headless Chromium, so these
 * tests may not be runnable here — see the README-equivalent note in the
 * task report. The config is written to "just work" wherever browsers CAN
 * be installed (`npx playwright install chromium`), including CI.
 *
 * `reuseExistingServer: true` locally means this won't fight an
 * already-running `pnpm dev` on :3001 — Playwright reuses it instead of
 * spawning a second instance.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // `exactOptionalPropertyTypes` (tsconfig.base.json) forbids `workers:
  // undefined` explicitly — omit the key locally so Playwright's own
  // default (based on CPU count) applies, only pin it to 1 in CI.
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
