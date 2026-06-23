# AGENTS.md — Conventions for AI Coding Agents

This file is for AI coding agents (Claude Code, Cursor, Copilot, etc.) working on this codebase. It describes conventions, rules, and things to never do.

---

## Boot Order (critical)

`src/mastra/index.ts` must initialize in this exact order:

```
1. env validation   (import env from '../lib/env')
2. AIMock setup     (configureAIMock())
3. Mastra instance  (new Mastra({ ... }))
```

**Why**: The Vercel AI SDK reads provider base URLs at client instantiation and caches them. AIMock must overwrite env vars before any AI SDK client is constructed. Env must validate before AIMock so it can read `USE_AIMOCK` and `AIMOCK_URL`.

Never reorder these. Never construct an `Agent` or `@ai-sdk/*` client before `configureAIMock()` is called.

---

## Import Rules

- Use **relative imports** for everything inside `src/mastra/`
- `src/lib/env` is the only cross-boundary import allowed in `src/mastra/`
- Never import from `src/mastra/` in `src/lib/`
- Never use barrel/index files — import from the specific file

```typescript
// correct
import { env } from '../../lib/env';
import { leadIntakeAgent } from './agents/_example';

// wrong
import { env } from '@/lib/env';           // no path aliases
import { leadIntakeAgent } from './agents'; // no barrel imports
```

---

## Environment Variables

All env vars flow through `src/lib/env.ts`. This is the single source of truth.

Rules:
- Never read `process.env.*` directly outside of `src/lib/env.ts`
- When adding a new env var: add to the Zod schema in `env.ts` AND to `.env.example` at the same time
- Optional vars use `.optional()` in the schema; required vars have no default
- Boolish vars (`USE_AIMOCK`) use the `boolish` transform defined at the top of `env.ts`

---

## Agent Conventions

File naming: `src/mastra/agents/<kebab-name>.ts` (prefix `_` for examples/templates).

Every agent file must export:
1. A named Zod schema (e.g. `LeadSchema`) and its inferred type
2. The agent instance with `id`, `name`, `instructions`, `model`, and `scorers`

Model string format: `anthropic/claude-sonnet-4-6` (provider/model-id).

Scorers are declared inline on the agent. Scorer implementations live in `src/mastra/scorers/`. Every agent should have at least a hallucination scorer.

Tools used only by one agent live inline in that agent's file. Shared tools go in `src/mastra/tools/`.

---

## Scorer Conventions

File naming: `src/mastra/scorers/<agent-name>.scorers.ts`.

Dataset files: `src/mastra/scorers/datasets/<agent-name>.json`.

Every scorer file exports named scorers. Every dataset file has `agentId`, `thresholds`, and `cases` — minimum 5 cases, at least 1 anti-hallucination case.

Correct import paths for prebuilt scorers:
```typescript
import { createHallucinationScorer, createPromptAlignmentScorerLLM } from '@mastra/evals/scorers/prebuilt';
// NOT from '@mastra/evals/scorers/llm' or '@mastra/evals/scorers/code'
```

Note: `createPromptAlignmentScorerLLM` with `evaluationMode: 'system'` requires system-prompt data in the inline scorer input. Register it on the agent only without that option, or run it manually in eval.ts. The default (no `evaluationMode`) works correctly for both inline and manual use.

---

## Storage

The Mastra instance uses a composite store:
- **default domain** → `PostgresStore` (Supabase Postgres via `SUPABASE_DB_URL`)
- **observability domain** → `DuckDBStore`

Both require an explicit `id` field:
```typescript
new PostgresStore({ id: 'mastra-storage', connectionString: env.SUPABASE_DB_URL })
```

`DuckDBStore` requires glibc. Do not run it in Alpine-based containers — use `node:22-slim`.

---

## Reachability conventions

Every agent registered in `src/mastra/index.ts` is reachable through four standard protocols, configured at the Mastra level:

- REST: `POST /api/agents/{agentId}/generate` (and `/stream`) — automatic
- A2A agent card: `GET /api/.well-known/{agentId}/agent-card.json` — automatic
- A2A execute: `POST /api/a2a/{agentId}` (JSON-RPC, `method: "message/send"`) — automatic
- MCP: `POST /api/mcp/{serverId}/mcp` — via `MCPServer` instance in `src/mastra/index.ts`
- Studio: `localhost:4111` UI — automatic via `mastra dev`

Note: `/a2a/{agentId}` (without `/api` prefix) is caught by Studio's router and returns HTML. Always use the `/api/` prefix for A2A and MCP calls.

When adding a new agent:
1. Register it in the `agents` field of the Mastra constructor (gets REST + A2A + Studio automatically)
2. Add it to the `agents` field of the `MCPServer` instance (exposes via MCP as `ask_<agentId>`)
3. Ensure the agent has a non-empty `description` property — MCPServer fails to start without it

The `MastraEditor` instance gives non-developers a way to iterate on agent prompts and tools without code changes. Changes are versioned and stored in the `editor` storage domain. The editor is mandatory for every template in this family.

---

## Things to Never Do

- **Never read `process.env` directly** — use `env` from `src/lib/env.ts`
- **Never construct an AI SDK client before `configureAIMock()`** — AIMock will be bypassed silently
- **Never set `ANTHROPIC_BASE_URL = AIMOCK_URL` bare** — `@ai-sdk/anthropic` appends `/messages`, so set it to `${AIMOCK_URL}/v1` to land at `/v1/messages` (where AIMock actually listens)
- **Never change the Dockerfile base to `node:22-alpine`** or any musl-based image — DuckDB native binaries will SIGSEGV at runtime. If you genuinely need a smaller image, swap `DuckDBStore` for `LibSQLStore` in the observability domain in `src/mastra/index.ts` instead. See README "Deployment Notes".
- **Never add a new env var without updating `.env.example`** — new devs won't know it exists
- **Never skip the Zod schema for a new env var** — process will start with undefined values silently
- **Never import from `src/mastra/` in `src/lib/`** — creates circular dependency risk
- **Never register an agent before its file passes typecheck** — comment it out until types are clean
- **Never use barrel/index imports** — import from the specific file

---

## Ask Before Acting

Stop and confirm with the user before making these changes:

- Changing the boot order in `src/mastra/index.ts`
- Removing or renaming a scorer that's referenced in a dataset JSON
- Downgrading a Mastra package version
- Adding a new `domain` to the composite store
- Any Supabase schema migrations

---

## Useful Commands

```bash
npm run dev          # Start Studio at localhost:4111
npm run typecheck    # Verify types before running
npm run eval         # Run all eval cases; exits 0 on pass, 1 on fail
npx supabase start   # Start local Supabase (Docker required)
```

Eval runs with `USE_AIMOCK=false` hit the real Anthropic API and incur cost. Use `USE_AIMOCK=true` with AIMock running for free deterministic runs during development.
