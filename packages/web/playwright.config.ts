import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end: the FULL chat flow, AIMock-backed (zero LLM spend).
 *
 * Topology started by `webServer` below (in dependency order):
 *   AIMock (:4010)  ──>  Mastra server (:4111, USE_AIMOCK)  ──>  Next web (:3000)
 * Playwright drives a real browser against the web app; the web proxies to the
 * Mastra server, which routes LLM calls to AIMock's deterministic fixtures.
 *
 * PREREQUISITE — a Postgres with pgvector (Mastra Memory + PgVector). One-liner:
 *   docker run -d --name chatkit-pg -e POSTGRES_PASSWORD=postgres -p 5499:5432 \
 *     pgvector/pgvector:pg16
 *   docker exec chatkit-pg psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"
 * Override the DSN with E2E_DB_URL if your Postgres lives elsewhere.
 */

const DB_URL =
  process.env.E2E_DB_URL ??
  process.env.SUPABASE_DB_URL ??
  'postgres://postgres:postgres@127.0.0.1:5499/postgres';

const AIMOCK_URL = process.env.AIMOCK_URL ?? 'http://127.0.0.1:4010';
const SERVER_URL = process.env.MASTRA_SERVER_URL ?? 'http://127.0.0.1:4111';
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3000);
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

// Env for the Mastra server: route LLM calls at AIMock, point Memory at the
// pgvector Postgres, satisfy env.ts (an LLM key is required even under AIMock —
// validation runs before the AIMock provider switch). All non-secret test values.
const serverEnv: Record<string, string> = {
  USE_AIMOCK: 'true',
  AIMOCK_URL,
  SUPABASE_DB_URL: DB_URL,
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
      env: { MASTRA_SERVER_URL: SERVER_URL },
    },
  ],
});
