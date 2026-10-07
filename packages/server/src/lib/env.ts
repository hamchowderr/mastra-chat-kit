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

/** `*_API_KEY` vars that unlock a tool, not a model, so they don't satisfy the model-key check. */
const NON_MODEL_KEYS = new Set(['FIRECRAWL_API_KEY']);

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

    // Root dir the controller agent's workspace (filesystem + shell sandbox) works
    // in — it reads/writes files and runs commands here. Set an absolute path for
    // a stable location; a relative path is resolved to absolute at load.
    WORKSPACE_ROOT: z.string().default('./agent-workspace'),

    // Browser slot for the controller workspace (@mastra/browser-viewer). It manages
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

    // What the agent can do. Every switch defaults to the full kit; turn pieces off for
    // an assistant that should not have them (lib/features.ts reads these).
    //
    // The workspace always has its filesystem and file tools; the shell sandbox and the
    // browser each have a switch. WORKSPACE_BROWSER=false turns the browser off whatever
    // BROWSER_PROVIDER says.
    WORKSPACE_SANDBOX: boolish.default(true),
    WORKSPACE_BROWSER: boolish.default(true),
    // Which browser (lib/features.ts resolveBrowser). `viewer`: the local Chrome above,
    // which the agent drives with the browser CLI through the sandbox. `firecrawl`: hosted
    // Firecrawl browser sessions with the provider's own browser_* tools
    // (lib/firecrawl-browser.ts), needing FIRECRAWL_API_KEY and no sandbox. Unset:
    // `firecrawl` when the key is set and the sandbox is off, otherwise `viewer` when the
    // sandbox is on, otherwise no browser.
    BROWSER_PROVIDER: z
      .union([z.enum(['viewer', 'firecrawl']), z.literal('')])
      .optional()
      .transform((v) => v || undefined),
    // The specialist subagents the chat agent may delegate to. `data` also needs Dolt.
    SUBAGENT_CODE: boolish.default(true),
    SUBAGENT_RESEARCH: boolish.default(true),
    SUBAGENT_WRITER: boolish.default(true),
    SUBAGENT_REVIEW: boolish.default(true),
    SUBAGENT_DATA: boolish.default(true),
    // generateImage (needs OPENAI_API_KEY), and the demo tools getWeather + searchKnowledge.
    TOOL_GENERATE_IMAGE: boolish.default(true),
    TOOL_DEMO: boolish.default(true),
    // Anthropic prompt caching (lib/turn-context.ts): cache breakpoints after the tools and
    // instructions, after the stable turn-context sections, and on the conversation tail.
    // Other providers ignore the markers.
    PROMPT_CACHE: boolish.default(true),

    // Firecrawl web search (lib/firecrawl.ts). Setting the key turns it on: the agent
    // and the research subagent get Firecrawl's search and scrape tools from Firecrawl's
    // hosted MCP server, with no sandbox or browser needed. Blank = off.
    FIRECRAWL_API_KEY: z
      .string()
      .optional()
      .transform((v) => v?.trim() || undefined),
    // The MCP endpoint those tools come from. The default is Firecrawl's hosted server;
    // override it for a self-hosted `firecrawl-mcp` (HTTP_STREAMABLE_SERVER=true) or a mock.
    FIRECRAWL_MCP_URL: z.string().url().default('https://mcp.firecrawl.dev/v2/mcp'),
    // The Firecrawl API the `firecrawl` browser provider creates its sessions on. Override
    // it for a self-hosted Firecrawl or a mock (scripts/firecrawl-browser-mock.ts).
    FIRECRAWL_API_URL: z.string().url().default('https://api.firecrawl.dev'),
    // Caps on each hosted browser session, in seconds: Firecrawl's `ttl` (total lifetime,
    // 30-3600) and `activityTtl` (idle time, 10-3600). Sessions are closed when the run
    // ends; these bound one left open, e.g. while a run waits on an approval.
    FIRECRAWL_BROWSER_TTL: z.coerce.number().int().min(30).max(3600).default(600),
    FIRECRAWL_BROWSER_IDLE_TTL: z.coerce.number().int().min(10).max(3600).default(300),
    // The time zone for a turn whose browser sent none (a scheduled run, an old client):
    // an IANA name such as `America/New_York`. The agent reads today's date in it
    // (src/mastra/lib/turn-context.ts). An unknown name falls back to UTC.
    DEFAULT_TIMEZONE: z.string().default('UTC'),

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

    // The model the chat agent uses (the Agent Controller wraps it).
    // `provider/model` form, resolved by Mastra's model router — set it to any provider
    // (see mastra.ai/models). Thread auto-titles derive a cheap model from this same
    // provider automatically (lib/memory.ts). Override to run a cheap model in dev.
    CHAT_MODEL: z.string().default('anthropic/claude-sonnet-4-6'),

    // Observational memory is ALWAYS on (core to the kit) — no env toggle; what the
    // workspace carries has its own switches below. OM and the agent's workspace are gated OFF when NODE_ENV is 'test'
    // so AIMock runs stay hermetic, and OM is also off under USE_AIMOCK (a mock can't play
    // its Observer); see lib/memory.ts + agents/chat.ts.

    USE_AIMOCK: boolish.default(false),
    AIMOCK_URL: z.string().url().default('http://localhost:4010'),

    E2E_BASE_URL: z.string().url().optional(),

    MASTRA_TELEMETRY_DISABLED: z.string().optional(),
    MASTRA_CLOUD_ACCESS_TOKEN: z.string().optional(),

    // Shared HMAC secret for JWT auth (@mastra/auth). When set, the server
    // gates all /api/* routes, the chat-kit contract routes AND Studio behind a
    // Bearer JWT signed with this secret. Leave unset for open local dev. Must be
    // HS256-safe (>=32 chars). The web proxy signs its requests with the same
    // secret, and the token's `sub` (the signed-in user) picks that user's Session,
    // so each user gets their own threads. Unset = one shared Session.
    MASTRA_JWT_SECRET: z.string().min(32, 'MASTRA_JWT_SECRET must be at least 32 chars').optional(),
  })
  .refine(
    // Provider-agnostic. `CHAT_MODEL` is resolved by Mastra's model router, which derives
    // the required key from the provider prefix (e.g. `groq/…` → `GROQ_API_KEY`) and errors
    // clearly if it's missing (https://mastra.ai/models/environment-variables). So we only
    // fail fast when NO provider key at all is set — any `<PROVIDER>_API_KEY` (or a gateway
    // token) is accepted: openai, anthropic, google, groq, xai, deepseek, mistral, …
    // Keys for tools rather than models (FIRECRAWL_API_KEY) do not count.
    () =>
      Object.entries(process.env).some(
        ([k, v]) =>
          Boolean(v) &&
          !NON_MODEL_KEYS.has(k) &&
          (k.endsWith('_API_KEY') || k === 'MASTRA_CLOUD_ACCESS_TOKEN'),
      ),
    {
      message:
        'Set the API key for your CHAT_MODEL provider (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, GROQ_API_KEY, …). See https://mastra.ai/models/environment-variables.',
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
