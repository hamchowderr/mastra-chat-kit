import path from 'node:path';
import { z } from 'zod';

/**
 * Resolve a relative `file:` libSQL URL to an ABSOLUTE path at load time. Under
 * `mastra dev` the process cwd differs between module load (package root) and
 * request handling (the bundled runtime dir), so a bare `file:./mastra.db` would
 * split reads/writes/deletes across two different files — threads persist to one
 * and the sidebar reads the other. Pinning it absolute keeps every op on one DB.
 */
function absoluteFileUrl(url: string): string {
  if (!url.startsWith('file:')) return url;
  const p = url.slice('file:'.length);
  if (p.startsWith('/') || path.isAbsolute(p)) return url;
  return `file:${path.resolve(process.cwd(), p.replace(/^\.\//, '')).replace(/\\/g, '/')}`;
}

const boolish = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 chars'),

    // Storage + vectors run on libSQL/Turso. Local dev uses a file: DB (no
    // server, no Docker); prod points at a libsql:// Turso URL with an auth
    // token. To switch the whole kit back to Postgres, see docs/postgres.md.
    TURSO_DATABASE_URL: z.string().default('file:./mastra.db').transform(absoluteFileUrl),
    TURSO_AUTH_TOKEN: z.string().optional(),

    // Root dir the harness agent's workspace (filesystem + shell sandbox) works
    // in — it reads/writes files and runs commands here. Set an absolute path for
    // a stable location; a relative path is resolved to absolute at load.
    WORKSPACE_ROOT: z.string().default('./agent-workspace'),

    // Browser slot for the harness workspace (@mastra/browser-viewer). It manages
    // a Playwright-driven Chrome and injects its CDP URL into the CLI the agent
    // shells out to — so `agent-browser <cmd>` in the sandbox drives the SAME
    // browser the native browser tools drive. Launch is lazy (nothing spawns at
    // boot), so this is safe to leave on under AIMock/tests.
    BROWSER_CLI: z
      .enum(['agent-browser', 'browser-use', 'browse', 'browse-cli'])
      .default('agent-browser'),
    // Headless by default: the live browser panel screencasts frames into the UI
    // (P3), so a visible OS window isn't needed. Set false to pop a real window.
    BROWSER_HEADLESS: boolish.default(true),
    // playwright-core ships NO browser binary. Point this at an installed Chrome
    // (or a `playwright install chromium` cache) if launch can't find one.
    BROWSER_EXECUTABLE_PATH: z.string().optional(),

    // Dolt (versioned business data) — the compose `dolt` service. Optional so
    // the app boots without Dolt; the Dolt tools error clearly if it's missing.
    DOLT_HOST: z.string().optional(),
    DOLT_PORT: z.coerce.number().int().optional(),
    DOLT_USER: z.string().optional(),
    DOLT_PASSWORD: z.string().optional(),
    DOLT_DATABASE: z.string().optional(),

    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

    // The model the chat agent uses (Single Agent + Agent Harness both wrap it).
    // `provider/model` form, resolved by Mastra's model router. Override to run a
    // real cheap model, e.g. CHAT_MODEL=openai/gpt-4.1-nano.
    CHAT_MODEL: z.string().default('anthropic/claude-sonnet-4-6'),

    USE_AIMOCK: boolish.default(false),
    AIMOCK_URL: z.string().url().default('http://localhost:4010'),

    E2E_BASE_URL: z.string().url().optional(),

    MASTRA_TELEMETRY_DISABLED: z.string().optional(),
    MASTRA_CLOUD_ACCESS_TOKEN: z.string().optional(),

    // Shared HMAC secret for JWT auth (@mastra/auth). When set, the server
    // gates all /api/* routes AND Studio behind a Bearer JWT signed with this
    // secret. Leave unset for open local dev. Must be HS256-safe (>=32 chars).
    MASTRA_JWT_SECRET: z.string().min(32, 'MASTRA_JWT_SECRET must be at least 32 chars').optional(),
  })
  .refine(
    (e) => Boolean(e.ANTHROPIC_API_KEY || e.OPENAI_API_KEY || e.GOOGLE_GENERATIVE_AI_API_KEY),
    {
      message:
        'At least one LLM provider key required (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY)',
    },
  );

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n');
  for (const [key, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${(errors as string[]).join(', ')}`);
  }
  for (const err of parsed.error.flatten().formErrors) {
    console.error(`  ${err}`);
  }
  console.error('\nSee .env.example for the full list of required variables.');
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;
