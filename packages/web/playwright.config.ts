import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end: the FULL chat flow, AIMock-backed (zero LLM spend).
 *
 * Topology started by `webServer` below (in dependency order):
 *   AIMock (:4010)  ──>  Mastra server (:4111, USE_AIMOCK)  ──>  Next web (:3000)
 * Playwright drives a real browser against the web app; the web proxies to the
 * Mastra server, which routes LLM calls to AIMock's deterministic fixtures.
 *
 * No external services: storage runs on a local libSQL file DB, so there's no
 * Postgres/pgvector to stand up. Override with E2E_DB_URL to point the server at a
 * different libSQL/Turso URL.
 */

const DB_URL = process.env.E2E_DB_URL ?? 'file:./mastra-e2e.db';

// Ports are overridable so the e2e stack doesn't collide with other local dev
// servers (set E2E_SERVER_PORT / E2E_WEB_PORT / AIMOCK_URL when 4111/3000/4010
// are taken). `reuseExistingServer` reuses whatever is already on a port, so a
// collision would silently run the tests against the wrong app.
const AIMOCK_URL = process.env.AIMOCK_URL ?? 'http://127.0.0.1:4010';
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 4111);
const SERVER_URL = process.env.MASTRA_SERVER_URL ?? `http://127.0.0.1:${SERVER_PORT}`;
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3000);
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

// Env for the Mastra server: route LLM calls at AIMock, point storage at a local
// libSQL file DB, satisfy env.ts (an LLM key is required even under AIMock —
// validation runs before the AIMock provider switch). All non-secret test values.
const serverEnv: Record<string, string> = {
  USE_AIMOCK: 'true',
  AIMOCK_URL,
  PORT: String(SERVER_PORT),
  TURSO_DATABASE_URL: DB_URL,
  APP_SECRET: 'e2e-app-secret-at-least-32-characters-long-xx',
  ANTHROPIC_API_KEY: 'mock',
  OPENAI_API_KEY: 'mock',
  CHAT_MODEL: 'anthropic/claude-sonnet-4-6',
  MASTRA_TELEMETRY_DISABLED: '1',
  LOG_LEVEL: 'info',
};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @mastra-chat-kit/server dev:mock',
      url: `${AIMOCK_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @mastra-chat-kit/server dev',
      url: `${SERVER_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: serverEnv,
    },
    {
      // Production build + start, NOT `next dev`: the Turbopack dev client's HMR
      // WebSocket fails under Playwright's headless Chromium and aborts React
      // hydration, leaving the page non-interactive. A production server hydrates
      // cleanly (and is what we actually ship).
      command: `pnpm exec next build && pnpm exec next start --port ${WEB_PORT}`,
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      // NODE_ENV=production is required: a `next build` inheriting NODE_ENV=development
      // builds in dev mode and its error-page prerender crashes (useContext of null).
      env: { MASTRA_SERVER_URL: SERVER_URL, NODE_ENV: 'production' },
    },
  ],
});
