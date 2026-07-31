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
    // Run test FILES one at a time.
    //
    // Every integration file drives real agent runs against the single AIMock server
    // on :4010, and `createDefaultMemory()` pulls the fastembed model. In parallel,
    // workers contend on both: AIMock drops connections (`AI_APICallError: read
    // ECONNRESET`, and assertions on the empty results that follow), and several
    // workers race to download the same model into one path and truncate it
    // (`ZlibError: zlib: unexpected end of file`). The symptom was a DIFFERENT test
    // failing each run while every one passed alone — the worst kind of red, because
    // it trains you to re-run instead of read.
    //
    // Serial costs ~30s on a 7-file suite and buys determinism. If this suite ever
    // grows enough for that to hurt, split the tiers rather than re-enabling
    // parallelism here: the unit files are safe to parallelize, the AIMock-backed
    // integration ones are not.
    fileParallelism: false,
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
