import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the production build in REPLAY mode: zero keys, no network.
const PORT = 3100;
const secret = 'e2e-only-secret-0123456789abcdef0123456789';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next build --webpack && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_DIST_DIR: '.next-e2e',
      NEXT_TELEMETRY_DISABLED: '1',
      VIGIL_MODE: 'replay',
      APPROVAL_HMAC_SECRET: secret,
      SESSION_SECRET: secret,
    },
  },
});
