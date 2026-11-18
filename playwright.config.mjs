import { defineConfig, devices } from '@playwright/test';
import { E2E_SECRET, PORT } from './e2e/helpers.mjs';

// iPad-Profile laut ARCHITEKTUR.md, jeweils hoch und quer.
// „iPad (gen 10)“ gibt es in Playwright 1.65 nicht – wie in rsg-app-vorlage wird „iPad (gen 11)“ verwendet.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}/mathebingo/`, locale: 'de-DE', timezoneId: 'Europe/Berlin', trace: 'retain-on-failure' },
  projects: [
    { name: 'iPad hoch', use: { ...devices['iPad (gen 11)'] } },
    { name: 'iPad quer', use: { ...devices['iPad (gen 11) landscape'] } },
    { name: 'iPad Pro 11 hoch', use: { ...devices['iPad Pro 11'] } },
    { name: 'iPad Pro 11 quer', use: { ...devices['iPad Pro 11 landscape'] } },
  ],
  webServer: {
    command: 'node server/index.mjs',
    url: `http://localhost:${PORT}/mathebingo/health`,
    // E2E_EXTERNAL=1: gegen einen schon laufenden Dienst testen (z. B. den Docker-Probelauf)
    reuseExistingServer: !!process.env.E2E_EXTERNAL,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      BASE_PATH: '/mathebingo',
      AUTH_SECRET: E2E_SECRET,
      ALLOWED_ORIGINS: `http://localhost:${PORT}`,
      TESTSYSTEM: 'true',
    },
  },
});
