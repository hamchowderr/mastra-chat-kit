# @mastra-chat-kit/server

**The reference server for [mastra-chat-kit](../../README.md) — the implementation
the chat layer's endpoint contract is written against.**

A stock `mastra dev` server does *not* satisfy that contract; it serves Mastra's own
`/api/agents/*` shape. This package registers the 14 routes the web layer and the
shadcn registry actually call, so it is what you point a consumer at, and what you
copy from when adding the contract to a server of your own. The contract itself is
specified in [`docs/registry.md`](../../docs/registry.md).

It is a **Mastra + Hono server on :4111**: an `AgentController` over a chat agent,
five subagents (code · research · writer · reviewer · data), a workspace sandbox
(filesystem + shell + browser), and libSQL for storage, threads, observability and
vector recall.

> **Setting the repo up for the first time?** Use the root
> [Getting started](../../README.md#-getting-started) — this is a pnpm workspace
> member and installing from inside it writes a second lockfile that can resolve
> versions dev and CI never tested. This file assumes the repo is already installed
> and covers what is specific to the server.

---

## Run it standalone

The root `pnpm dev` starts this server *and* the web app. To run only this one:

```bash
pnpm --filter @mastra-chat-kit/server dev
# → Mastra Studio at http://localhost:4111
```

Env lives in `packages/server/.env` (copy `.env.example`). Set `APP_SECRET` plus
model access: `CHAT_MODEL` is a `provider/model` string resolved by
[Mastra's model router](https://mastra.ai/models), so a single gateway key or a
per-provider key both work — no specific provider is required. Storage defaults to
a local libSQL file, so there is no database server and no Docker in dev.

Chat with the `chat` agent in Studio to verify everything works. Send:

> What files are in the workspace? Then create hello.txt with a short greeting.

Expected: the agent lists the workspace, then (after approval) writes the file.

---

## Reachability

Beyond the chat-kit contract, every registered agent is reachable through four
standard protocols. Once the dev server is running:

### REST API

Direct HTTP calls. The fastest path for n8n, Make, VAPI, LiveKit, or any HTTP-aware system.

```bash
curl -X POST http://localhost:4111/api/agents/chat/generate \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hi, I need a quote"}]}'
```

For streaming responses, use `/stream` instead of `/generate`. Full OpenAPI spec at `/api/openapi.json`. Interactive docs at `/swagger-ui` (dev only).

#### Working memory (persist context per user)

Agents have **working memory** enabled (resource-scoped — see `src/mastra/lib/memory.ts`). For it to persist across a user's conversations, pass `memory.resource` (a stable user ID) and `memory.thread` (the conversation ID) in the body:

```bash
curl -X POST http://localhost:4111/api/agents/chat/generate \
  -H "Content-Type: application/json" \
  -d '{
    "messages":[{"role":"user","content":"Hi, I need a quote"}],
    "memory":{"resource":"user-alice-456","thread":"conversation-123"}
  }'
```

Without `memory.resource`, working memory falls back to thread-only (no cross-conversation persistence). Semantic recall is intentionally off. Storage uses the Mastra instance's `LibSQLStore`, which supports the `mastra_resources` table resource-scoping needs — no extra setup.

### A2A (Agent-to-Agent Protocol)

Google's open standard for agent-to-agent communication. JSON-RPC over HTTP.

```bash
# Get agent card
curl http://localhost:4111/api/.well-known/chat/agent-card.json

# Send a message (JSON-RPC)
curl -X POST http://localhost:4111/api/a2a/chat \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","messageId":"msg-1","role":"user","parts":[{"kind":"text","text":"Hi, I need a quote"}]}}}'
```

Use this when another agent (in CrewAI, LangGraph, ADK, or any A2A-compatible framework) needs to delegate work to this server's agents.

### MCP (Model Context Protocol)

Anthropic's open standard for agent-tool integration. This server's MCPServer exposes every agent as a callable tool at `/api/mcp/chat-kit/mcp`.

To use from Claude Desktop, add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mastra-chat-kit": {
      "url": "http://localhost:4111/api/mcp/chat-kit/mcp"
    }
  }
}
```

Each agent appears as a tool named `ask_<agentId>`. Useful during development (call your own agent from your IDE) and for cross-system integration.

### Studio (visual UI + Editor)

Open `http://localhost:4111` in a browser. Studio provides:

- Interactive chat with each agent
- Trace inspection for every run
- Metrics dashboard (cost, latency, errors)
- **Agent Editor**: Non-developers iterate on agent instructions, prompts, and tools without touching code. Changes are versioned with draft/publish workflow.

The Editor is intended for product teams, prompt engineers, or subject-matter experts to tune behavior between deploys. Code-defined agents have read-only `id`, `name`, and `model` fields; everything else is editable through Studio.

For production deployment, secure Studio behind authentication. See [Mastra's auth docs](https://mastra.ai/docs/server/auth/overview).

---

## File Structure

```
packages/server/
├── src/
│   ├── lib/
│   │   └── env.ts                  # Zod-validated env loader — crashes on bad config
│   └── mastra/
│       ├── index.ts                # Boot: env → AIMock → Mastra; registers the route contract
│       ├── agents/
│       │   ├── chat.ts             # The agent the controller drives (+ its inline tools)
│       │   ├── code.ts             # Subagent: build/run in the sandbox
│       │   ├── research.ts         # Subagent: browse + search + cite
│       │   ├── writer.ts           # Subagent: long-form drafting
│       │   ├── reviewer.ts         # Subagent: read-only audit
│       │   └── data.ts             # Subagent: versioned SQL (only when Dolt is on)
│       ├── lib/
│       │   ├── agent-controller.ts # AgentController + Session — the engine
│       │   ├── workspace.ts        # Filesystem + shell sandbox + browser
│       │   ├── memory.ts           # Shared Memory: LibSQLVector + fastembed recall
│       │   ├── dolt.ts             # Optional versioned data, Git-style (mysql2)
│       │   ├── aimock.ts           # Routes LLM calls to AIMock when USE_AIMOCK=true
│       │   └── …                   # image-store, processors, thread-utils, workspace-files
│       └── tools/                  # Shared tools (dolt, schedule); inline tools live in agent files
├── tests/
│   ├── helpers/call-tool.ts        # Invoke a tool's execute() from a test, typed
│   ├── unit/                       # Pure logic — no LLM, no mock server
│   └── integration/                # Agent + controller flows through AIMock
├── fixtures/                       # AIMock fixtures (matched on turnIndex)
├── scripts/bake-studio.mjs         # Bakes Studio config for self-hosted serving
├── prompts/                        # Parameterized prompts for AI coding agents
├── supabase/config.toml            # Only for the optional Postgres path — see docs/postgres.md
├── Dockerfile                      # Multi-stage; build context is the REPO ROOT
├── docker-compose.yml              # Production compose (+ .override / compose.dev.yml)
├── aimock.json                     # AIMock server config (pnpm dev:mock)
├── .env.example                    # All required env vars with comments
└── AGENTS.md / CLAUDE.md           # Conventions for AI coding agents
```

> CI lives at the **repo root** (`.github/workflows/`), not here — GitHub only reads
> workflows from the root, so a nested one never runs. There used to be one in this
> package; it was dead for exactly that reason and has been removed.

---

## Scripts

Run these **from `packages/server`**. From the repo root, prefix with
`pnpm --filter @mastra-chat-kit/server` — and install from the root either way,
never inside this package (a second lockfile is how the container ended up on an
untested dependency tree).

| Command | What it does |
|---|---|
| `pnpm dev` | Start Mastra Studio at localhost:4111 |
| `pnpm build` | Bundle for production (output → `.mastra/output/`) |
| `pnpm start` | Start production server (no Studio) |
| `pnpm typecheck` | TypeScript type check (zero-emit) |
| `pnpm setup:browser` | Download the Chromium the controller Browser panel drives (run once after install) |

---

## Adding a New Agent

1. Copy `src/mastra/agents/chat.ts` → `src/mastra/agents/my-agent.ts`
2. Rename the agent, update `id`, `instructions`, `model`, and tools
3. Register it in `src/mastra/index.ts` under `agents:`
4. Use `prompts/build-agent.md` with Claude Code to generate a complete agent from a description

---

## Docker

```bash
# Build
docker build -t my-agent:latest .

# Run
docker compose up -d

# Health check
curl http://localhost:4111/health
```

The compose stack keeps the libSQL DB on the `libsqldata` volume, so no host
database is involved. Prefer Postgres for storage instead? See `docs/postgres.md`.

---

## Deployment Notes

### Docker image

The image is based on `node:22-slim` (Debian). Storage + vectors run on libSQL;
observability uses DuckDB, whose native binaries need glibc — so `node:22-slim` is
required (do not switch to `node:22-alpine`). No Postgres in the runtime.

For typical VPS deployments (DigitalOcean, Hostinger, etc.) the image size is not a
concern — pulls take seconds and storage is cheap.

---

## Common Gotchas

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid environment variables` on boot | Missing or malformed `.env` | Check each var listed in the error against `.env.example` |
| Threads/messages split or empty reads under `mastra dev` | A relative `file:` libSQL URL resolves against a shifting cwd | Use an absolute `TURSO_DATABASE_URL` (env.ts absolutizes `file:` URLs at load) |
| Agent not listed in Studio | Not registered in `mastra.agents` | Add to `src/mastra/index.ts` |
| Storage init error about missing `id` | `LibSQLStore`/`LibSQLVector` requires an `id` field | Pass `id: 'mastra-storage'` to the constructor |
| PostHog telemetry noise in restricted networks | Mastra runtime phones home on startup | Set `MASTRA_TELEMETRY_DISABLED=1` in `.env` |
| Prod libSQL auth errors | Turso needs a token | Set `TURSO_AUTH_TOKEN` alongside a `libsql://` `TURSO_DATABASE_URL` |
| Pino transport error in Docker | `pino-pretty` missing from production deps | Ensure it's in `dependencies`, not `devDependencies`, in any packages you add |
| Browser panel blank / screencast emits no frames | Chromium not installed, or `BROWSER_EXECUTABLE_PATH` points at a system Chrome (its launcher forks/detaches — `playwright-core` can't drive it headless) | Run `pnpm setup:browser` once; leave `BROWSER_EXECUTABLE_PATH` **unset** so browser-viewer uses its bundled Chromium |

---

## Environment Variables

See `.env.example` for the full list with comments. Minimum required:

- `APP_SECRET` — min 32 chars, generate with `openssl rand -hex 32`
- `TURSO_DATABASE_URL` — storage; defaults to `file:./mastra.db` for local dev (set a `libsql://` URL + `TURSO_AUTH_TOKEN` for Turso in prod)
- At least one of: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`

---

## For AI Coding Agents

See `AGENTS.md` for conventions, boot order, import rules, and things to never do.
