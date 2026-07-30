import { defineConfig } from 'vitest/config';

/**
 * Tier 1 — unit + integration, AIMock-backed, ZERO real API spend.
 *
 * `globalSetup` boots AIMock (port 4010, chat fixtures) once for the run.
 * `env` supplies the deterministic test environment: AIMock base URLs so the
 * `anthropic/*` model router hits AIMock, plus the env.ts-required vars so
 * importing the full Mastra instance never calls `process.exit(1)`.
 */
export default defineConfig({
  test: {
    globalSetup: ['./tests/aimock-setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      // NODE_ENV=test gates OM + the agent workspace OFF (see lib/memory.ts + agents/chat.ts)
      // so AIMock runs stay hermetic — the controller still supplies its own workspace.
      NODE_ENV: 'test',
      USE_AIMOCK: 'true',
      AIMOCK_URL: 'http://127.0.0.1:4010',
      // Route provider SDKs at AIMock (anthropic appends /messages to this base).
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:4010/v1',
      OPENAI_BASE_URL: 'http://127.0.0.1:4010/v1',
      ANTHROPIC_API_KEY: 'mock',
      OPENAI_API_KEY: 'mock',
      // env.ts requirements (only used if a test imports the full Mastra index).
      APP_SECRET: 'test-app-secret-at-least-32-characters-long',
      TURSO_DATABASE_URL: 'file:./mastra-test.db',
    },
  },
});
