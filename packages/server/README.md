# template-mastra-base

A production-ready Mastra agent starter. One example agent, full eval pipeline, Docker, CI — everything you need to ship a Mastra agent without building the scaffold yourself.

---

## Quickstart (5 minutes)

**Prerequisites**: Node 22+, an Anthropic API key. Storage runs on a local libSQL
file (`./mastra.db`) — no database server, no Docker needed for dev.

```bash
# 1. Clone and install
git clone <repo> my-agent && cd my-agent
npm install

# 2. Configure environment
cp .env.example .env
# Fill in: APP_SECRET, ANTHROPIC_API_KEY (storage defaults to a local libSQL file)

# 3. Run
npm run dev
# → Mastra Studio at http://localhost:4111
```

Chat with the `leadIntake` agent in Studio to verify everything works. Send:

> Hi, this is John Smith from Acme Corp (john@acme.io). We need pricing for 50 seats by Friday.

Expected: structured JSON output with all fields populated.

---

## Reachability

This template's agents are reachable through four standard protocols. Once the dev server is running (`npm run dev`), every registered agent can be called via:

### REST API

Direct HTTP calls. The fastest path for n8n, Make, VAPI, LiveKit, or any HTTP-aware system.

```bash
curl -X POST http://localhost:4111/api/agents/leadIntake/generate \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hi, I need a quote"}]}'
```

For streaming responses, use `/stream` instead of `/generate`. Full OpenAPI spec at `/api/openapi.json`. Interactive docs at `/swagger-ui` (dev only).

#### Working memory (persist context per user)

Agents have **working memory** enabled (resource-scoped — see `src/mastra/lib/memory.ts`). For it to persist across a user's conversations, pass `memory.resource` (a stable user ID) and `memory.thread` (the conversation ID) in the body:

```bash
curl -X POST http://localhost:4111/api/agents/leadIntake/generate \
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
curl http://localhost:4111/api/.well-known/leadIntake/agent-card.json

# Send a message (JSON-RPC)
curl -X POST http://localhost:4111/api/a2a/leadIntake \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","messageId":"msg-1","role":"user","parts":[{"kind":"text","text":"Hi, I need a quote"}]}}}'
```

Use this when another agent (in CrewAI, LangGraph, ADK, or any A2A-compatible framework) needs to delegate work to this template's agent.

### MCP (Model Context Protocol)

Anthropic's open standard for agent-tool integration. The template's MCPServer exposes every agent as a callable tool at `/api/mcp/base-mcp/mcp`.

To use from Claude Desktop, add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "template-mastra-base": {
      "url": "http://localhost:4111/api/mcp/base-mcp/mcp"
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
template-mastra-base/
├── src/
│   ├── lib/
│   │   └── env.ts                  # Zod-validated env loader — crashes on bad config
│   └── mastra/
│       ├── index.ts                # Entry point: env → AIMock → Mastra instance
│       ├── agents/
│       │   └── _example.ts         # leadIntake agent — copy this for new agents
│       ├── lib/
│       │   └── aimock.ts           # Routes LLM calls to AIMock when USE_AIMOCK=true
│       ├── scorers/
│       │   ├── _example.scorers.ts # hallucination + completeness + urgency scorers
│       │   └── datasets/
│       │       └── _example.json   # Eval dataset — 5 cases with thresholds
│       ├── tools/                  # Shared tools (inline tools live in agent files)
│       └── workflows/              # Mastra workflows
├── scripts/
│   └── eval.ts                     # Offline CI eval gate — exits 0/1 based on thresholds
├── prompts/
│   ├── README.md                   # Index of agent-building prompts
│   └── build-agent.md              # Parameterized prompt for adding a new agent
├── .github/
│   └── workflows/
│       └── ci.yml                  # typecheck → build + eval (parallel) → docker
├── Dockerfile                      # Multi-stage, node:22-slim runtime
├── docker-compose.yml              # Production compose
├── compose.dev.yml                 # Dev compose override
├── .env.example                    # All required env vars with comments
└── AGENTS.md                       # Conventions for AI coding agents
```

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Mastra Studio at localhost:4111 |
| `npm run build` | Bundle for production (output → `.mastra/output/`) |
| `npm run start` | Start production server (no Studio) |
| `npm run eval` | Run offline eval gate against all cases in the dataset |
| `npm run typecheck` | TypeScript type check (zero-emit) |
| `npm run score:list` | List registered scorers |
| `npm run setup:browser` | Download the Chromium the harness Browser panel drives (run once after install) |

---

## Adding a New Agent

1. Copy `src/mastra/agents/_example.ts` → `src/mastra/agents/my-agent.ts`
2. Rename the agent, update `id`, `instructions`, `model`, tools, and output schema
3. Register it in `src/mastra/index.ts` under `agents:`
4. Add eval cases to a new dataset file in `src/mastra/scorers/datasets/`
5. Use `prompts/build-agent.md` with Claude Code to generate a complete agent from a description

---

## Running Evals

```bash
# Against live Anthropic API
npm run eval

# Against AIMock (deterministic, no API cost)
npx @copilotkit/aimock --config aimock.json &
USE_AIMOCK=true npm run eval

# Custom dataset
node --env-file=.env --import tsx/esm scripts/eval.ts path/to/dataset.json
```

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
| Browser panel blank / screencast emits no frames | Chromium not installed, or `BROWSER_EXECUTABLE_PATH` points at a system Chrome (its launcher forks/detaches — `playwright-core` can't drive it headless) | Run `npm run setup:browser` once; leave `BROWSER_EXECUTABLE_PATH` **unset** so browser-viewer uses its bundled Chromium |

---

## Environment Variables

See `.env.example` for the full list with comments. Minimum required:

- `APP_SECRET` — min 32 chars, generate with `openssl rand -hex 32`
- `TURSO_DATABASE_URL` — storage; defaults to `file:./mastra.db` for local dev (set a `libsql://` URL + `TURSO_AUTH_TOKEN` for Turso in prod)
- At least one of: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`

---

## For AI Coding Agents

See `AGENTS.md` for conventions, boot order, import rules, and things to never do.
