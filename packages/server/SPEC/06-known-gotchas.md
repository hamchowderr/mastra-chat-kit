# 06 — Known Gotchas

Pitfalls discovered during template scoping. Read before debugging anything weird.

## CLI quirks

### `--no-example` is partially ignored

The `npx create-mastra` CLI generates the weather example even with `--no-example`. The starting state for this build assumes the weather files were scaffolded — Phase 1 of the build order deletes them.

### `--llm anthropic` doesn't change `.env.example`

Regardless of which `--llm` provider you select, the scaffolded `.env.example` only contains `OPENAI_API_KEY=your-api-key`. Phase 3 replaces it with the full version per spec.

### No `.env` file is created

The `--llm-api-key` flag doesn't actually write to a `.env` file — only `.env.example` is touched, and it ignores the key. You must `cp .env.example .env` and fill in manually.

### No `--skills` flag

The CLI does not have a `--skills` flag despite earlier documentation suggesting it does. Skills are installed separately via the Mastra Skills CLI. Don't try to add `--skills claude-code` etc.

### No git init despite `--default`

`--default` does NOT init git. `git init` manually after scaffolding.

## Resource-scoped working memory silently no-ops without `resource`

`createDefaultMemory()` enables working memory with `scope: 'resource'`. It only persists per user when the caller passes `memory: { thread, resource }` to `agent.generate()` / the REST body. Omit `resource` and it silently falls back to thread-only — no error, just no cross-conversation persistence. The REST contract is documented in `README.md`. Also note: resource-scoping requires a storage adapter with the `mastra_resources` table (Postgres/Supabase here — fine; bare LibSQL file mode does not).

## Processors in `lib/` are agent processors, NOT the observability span processor

`SensitiveDataFilter` in `index.ts` is a `spanOutputProcessors` entry — it scrubs observability traces, not agent I/O. The agent-level baseline lives in `lib/processors.ts` (`UnicodeNormalizer` + `TokenLimiter`). Don't conflate them. Also: these are not memory processors, so they don't suppress Mastra's auto-added `MessageHistory` / `WorkingMemory` processors (those still run).

## PostHog telemetry leaks errors in restricted networks

Mastra's CLI (and possibly runtime) tries to send telemetry to PostHog. On networks that block this (corporate firewalls, sandboxed environments), the failure produces a noisy stack trace that looks like an error but isn't fatal.

**Fix**: set `MASTRA_TELEMETRY_DISABLED=1` in env. Recommend it in README and `.env.example`.

## Path aliases break Mastra's bundler

Don't use TypeScript path aliases (`@/*`) inside `src/mastra/`. Mastra's bundler has known issues resolving them; bundled `.mastra/output/index.mjs` may throw `Cannot find package '~'` or similar.

**Rule**: relative imports only inside `src/mastra/`. Aliases are fine elsewhere (e.g., `src/lib/`).

## Pino transports in Docker

`@mastra/loggers`'s `PinoLogger` uses `pino-pretty` internally for dev output. If `pino-pretty` ends up in `devDependencies` (not `dependencies`), Docker production image will fail at runtime when trying to load the transport.

**Fix**: confirm `pino-pretty` is in `dependencies` of `@mastra/loggers`. If you ever override `transports`, ensure those packages are in regular dependencies. Or set `prettyPrint: false` in Pino config for production.

## Supabase connection string format

Use the **session pooler** connection string from Supabase dashboard (Project Settings > Database > Connection string > URI > "Session pooler"), NOT the direct connection. The direct connection has too few connection slots for Mastra's pooled query patterns.

The session pooler format looks like:
```
postgres://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

Direct connection (don't use):
```
postgres://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
```

## `@mastra/voice-google-gemini-live` env var conflict

If you ever use Mastra's voice package, note that `@mastra/voice-google-gemini-live` reads `GOOGLE_API_KEY` (not `GOOGLE_GENERATIVE_AI_API_KEY` like the AI SDK does). To avoid duplicating env vars, pass the key explicitly when constructing `GeminiLiveVoice`:

```typescript
new GeminiLiveVoice({
  apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
  // ...
});
```

This is for the future voice template — not relevant in base.

## Mastra build OOM

`npx mastra build` can hit JavaScript heap out of memory on large projects. If you see this:

```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run build
```

Document this in CI workflow (already done) and in README.

## TypeScript module/moduleResolution requirements

Mastra requires:
- `"module": "ES2022"` (or higher)
- `"moduleResolution": "bundler"`

The scaffold sets these correctly. **Do not change them** — older settings cause cryptic resolution errors when importing from `@mastra/*`.

## `MastraCompositeStore` requires top-level await

The recommended composite store config uses `await new DuckDBStore().getStore('observability')` at module scope. This requires `"module": "ES2022"` (which is set). If you see "top-level await is not supported", check tsconfig.

## DuckDB requires glibc

`@mastra/duckdb` ships native binaries compiled against glibc. These segfault on Alpine Linux (musl libc) even with `gcompat` installed.

The Dockerfile uses `node:22-slim` (Debian-based, glibc) instead of `node:22-alpine` (musl). This costs ~500MB in image size but is required for runtime stability. Do not "optimize" by switching to Alpine — the container will crash on first observability span.

If image size is critical, swap `DuckDBStore` for `LibSQLStore` in the observability domain in `src/mastra/index.ts`.

## DuckDB on macOS / unusual platforms

`@mastra/duckdb` ships native binaries. On macOS (especially Apple Silicon), it should "just work" via `npm install`. On unusual platforms (e.g., Alpine in Docker), you may need to configure platform-specific binaries — this is why the Dockerfile installs `gcompat`.

## AIMock fixtures

By default, AIMock returns generic acknowledgments — not useful for testing structured-output agents. To make CI eval meaningful with AIMock, you need an `aimock.json` config with response fixtures matching expected agent outputs for each canonical input.

This is out of scope for this build (eval still works against live API; AIMock-CI is a future enhancement). Document as a follow-up in `PROGRESS.md`.

## Mastra Studio behavior under load

Studio is a development tool. In production, you typically don't expose Studio publicly — the auto-generated REST API at `/api/agents/{id}/generate` is what external clients hit. The `mastra start` command (used in Docker) runs the API but Studio behavior may differ. If something works in `mastra dev` but not in `mastra start`, suspect Studio-only debug paths.

## `--llm google` writes wrong env var name

If you use `--llm google` during scaffold (not the case here, but flagging), the scaffolded code may use `GOOGLE_API_KEY` while the AI SDK actually wants `GOOGLE_GENERATIVE_AI_API_KEY`. Verify and rename if needed.

## Top-level `await` in Mastra index

Some builds fail because `tsc` can't handle top-level `await` despite `module: ES2022`. If this happens during typecheck:

- Confirm `target: ES2022` in tsconfig (also required, in addition to `module`)
- Or wrap the composite store init in an async IIFE and export a Promise

Try the first fix first; the scaffold's tsconfig should already be correct.
