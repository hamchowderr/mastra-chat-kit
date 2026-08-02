# AGENTS.md — Conventions for AI Coding Agents

This file is for AI coding agents (Claude Code, Cursor, Copilot, etc.) working on this codebase. It describes conventions, rules, and things to never do.

---

## CRITICAL: Load the `mastra` skill first

Load the `mastra` skill **before any Mastra work** on this codebase. Never rely on
cached knowledge — Mastra APIs change between versions, and this kit pins exact
`@mastra/*` versions. If the skill isn't available, consult the current docs at
<https://mastra.ai/llms.txt> instead of guessing from memory.

---

## Route Layout

`index.ts` wires the Mastra instance; it does not contain route handlers. The
AgentController route contract lives in `src/mastra/routes/`, split by surface:

| File | Routes |
|---|---|
| `routes/threads.ts` | conversation history — list, semantic search, messages, DELETE, PATCH |
| `routes/controller.ts` | the run surface — stream (SSE), approve, answer, goal, om, schedules |
| `routes/workspace.ts` | files, file, browser screencast (SSE), generated images |

Each exports a **factory** — `createThreadRoutes(deps)` etc. — returning an array
of `registerApiRoute(...)` results that `index.ts` spreads into
`serverConfig.apiRoutes`.

### The routes must not import the wiring

`routes/types.ts` defines `ChatServerDeps`: session and controller accessors, the
workspace reader, the image store, the browser, an optional search pair, an agent
id and a model allowlist. `index.ts` supplies this repo's implementation.

This is not ceremony. When the routes imported `lib/agent-controller` directly,
their transitive closure was **2283 lines across 20 files** — all six agents, the
tools, memory, processors, Dolt and env — because the controller wires all of it.
The routes are the portable half (the HTTP contract the web layer speaks);
everything else is *this repo's* reference implementation and must not be dragged
along behind it. Adding an import of `lib/`, `agents/` or `tools/` to a route
module re-creates that coupling — put it in `ChatServerDeps` instead.

Corollaries:

- `deps.search` is **optional**. `/threads/search` answers `{ threads: [] }` when
  it is absent, so a consumer with no vector index still gets a working sidebar.
- **Never import `mastra` from `index.ts`** — `index.ts` imports the route
  modules, so that is circular. Reach the instance through the Hono context,
  which Mastra types as `CustomRouteVariables`:

```typescript
const memory = await c.get('mastra').getAgent(deps.agentId).getMemory();
```

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
import { chatAgent } from './agents/chat';

// wrong
import { env } from '@/lib/env';        // no path aliases
import { chatAgent } from './agents';   // no barrel imports
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

File naming: `src/mastra/agents/<kebab-name>.ts`.

Every agent file exports its agent instance with `id`, `name`, `instructions`, `model`,
and `tools` (plus `memory`/`workspace` where relevant). Agents that return structured
data also export a named Zod schema + its inferred type.

Model string format: `anthropic/claude-sonnet-4-6` (provider/model-id).

Tools used only by one agent live inline in that agent's file. Shared tools go in `src/mastra/tools/`.

---

## Storage

The Mastra instance runs on **libSQL/Turso**. A `LibSQLStore` serves the
default/editor/memory domains, and `LibSQLVector` (see `src/mastra/lib/memory.ts`)
backs semantic recall (native vector search, no pgvector). Observability alone uses
DuckDB (OLAP) via a `MastraCompositeStore` — Studio's Metrics/Logs need it.

```typescript
new LibSQLStore({ id: 'mastra-storage', url: env.TURSO_DATABASE_URL })
```

`url` is `file:./mastra.db` for local dev (no server, no Docker) and a `libsql://`
Turso URL (with `TURSO_AUTH_TOKEN`) in prod. Both `LibSQLStore` and `LibSQLVector`
require an explicit `id`. To switch the kit to Postgres, see `docs/postgres.md`.

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

The `MastraEditor` instance gives non-developers a way to iterate on agent prompts and tools without code changes. Changes are versioned and stored in the `editor` storage domain. Keep it wired — the kit's Studio workflow assumes it.

---

## Things to Never Do

- **Never read `process.env` directly** — use `env` from `src/lib/env.ts`
- **Never construct an AI SDK client before `configureAIMock()`** — AIMock will be bypassed silently
- **Never set `ANTHROPIC_BASE_URL = AIMOCK_URL` bare** — `@ai-sdk/anthropic` appends `/messages`, so set it to `${AIMOCK_URL}/v1` to land at `/v1/messages` (where AIMock actually listens)
- **Never treat a `file:` libSQL DB as multi-writer** — a local `file:./mastra.db` is single-process; for prod / multi-process use a `libsql://` Turso URL (with `TURSO_AUTH_TOKEN`), or switch to Postgres (`docs/postgres.md`).
- **Never add a new env var without updating `.env.example`** — new devs won't know it exists
- **Never skip the Zod schema for a new env var** — process will start with undefined values silently
- **Never import from `src/mastra/` in `src/lib/`** — creates circular dependency risk
- **Never register an agent before its file passes typecheck** — comment it out until types are clean
- **Never use barrel/index imports** — import from the specific file

---

## Ask Before Acting

Stop and confirm with the user before making these changes:

- Changing the boot order in `src/mastra/index.ts`
- Downgrading a Mastra package version
- Switching the storage backend (libSQL ⇄ Postgres — see `docs/postgres.md`)

---

## Useful Commands

```bash
pnpm dev          # Start Studio at localhost:4111
pnpm typecheck    # Verify types before running
pnpm test             # Run the vitest suite
```

Eval runs with `USE_AIMOCK=false` hit the real Anthropic API and incur cost. Use `USE_AIMOCK=true` with AIMock running for free deterministic runs during development.
