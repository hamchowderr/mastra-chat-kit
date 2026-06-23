# Base Polish 03 — Verify Reachability + Document

Confirm all four reachability paths work, then document them in README and AGENTS.md.

## Step 1: Verify all four endpoints

Open a second terminal. With `mastra dev` running:

### REST endpoint
```bash
curl -X POST http://localhost:4111/api/agents/leadIntake/generate \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hi, my name is Test User and I need help with billing"}]}'
```

**Pass**: HTTP 200, response contains structured lead data.

### A2A endpoint
```bash
curl http://localhost:4111/a2a/leadIntake
```

**Pass**: returns JSON describing the agent. Mastra exposes A2A automatically at `/a2a/{agentId}` for every registered agent. If 404, document in PROGRESS.md and report — A2A may have moved in a recent Mastra release, in which case we update the standard.

### MCP endpoint
```bash
curl -X POST http://localhost:4111/api/mcp/baseMcp/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

**Pass**: HTTP 200, JSON-RPC response listing tools. The `ask_leadIntake` tool must be in the list.

### Studio + Editor
Open `http://localhost:4111` in a browser.

**Pass**:
- Studio UI loads
- `leadIntake` visible in agent list
- Editor tab present on the agent
- Can edit instructions, save a draft

## Step 2: Document in README

Add a "Reachability" section after Quickstart, before Configuration. Use this exact content (adjust agent names to match the template's reality):

```markdown
## Reachability

This template's agents are reachable through four standard protocols. Once the dev server is running (`npm run dev`), every registered agent can be called via:

### REST API

Direct HTTP calls. The fastest path for n8n, Make, VAPI, LiveKit, or any HTTP-aware system.

\`\`\`bash
curl -X POST http://localhost:4111/api/agents/leadIntake/generate \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hi, I need a quote"}]}'
\`\`\`

For streaming responses, use `/stream` instead of `/generate`. Full OpenAPI spec at `/api/openapi.json`. Interactive docs at `/swagger-ui` (dev only).

### A2A (Agent-to-Agent Protocol)

Google's open standard for agent-to-agent communication. JSON-RPC over HTTP. Agents are exposed at `/a2a/{agentId}` automatically.

\`\`\`bash
# Get agent card
curl http://localhost:4111/a2a/leadIntake
\`\`\`

Use this when another agent (in CrewAI, LangGraph, ADK, or any A2A-compatible framework) needs to delegate work to this template's agent.

### MCP (Model Context Protocol)

Anthropic's open standard for agent-tool integration. The template's MCPServer exposes every agent as a callable tool at `/api/mcp/baseMcp/mcp`.

To use from Claude Desktop, add to your `claude_desktop_config.json`:

\`\`\`json
{
  "mcpServers": {
    "template-mastra-base": {
      "url": "http://localhost:4111/api/mcp/baseMcp/mcp"
    }
  }
}
\`\`\`

Each agent appears as a tool named `ask_<agentId>`. Useful during development (call your own agent from your IDE) and for cross-system integration.

### Studio (visual UI + Editor)

Open `http://localhost:4111` in a browser. Studio provides:

- Interactive chat with each agent
- Trace inspection for every run
- Metrics dashboard (cost, latency, errors)
- **Agent Editor**: Non-developers iterate on agent instructions, prompts, and tools without touching code. Changes are versioned with draft/publish workflow.

The Editor is intended for product teams, prompt engineers, or subject-matter experts to tune behavior between deploys. Code-defined agents have read-only `id`, `name`, and `model` fields; everything else is editable through Studio.

For production deployment, secure Studio behind authentication. See [Mastra's auth docs](https://mastra.ai/docs/server/auth/overview).
```

## Step 3: Document in AGENTS.md

Open `AGENTS.md`. Find the conventions section (or add one if missing). Add:

```markdown
## Reachability conventions

Every agent registered in `src/mastra/index.ts` is reachable through four standard protocols, configured at the Mastra level:

- REST: `POST /api/agents/{agentId}/generate` (and `/stream`) — automatic
- A2A: `/a2a/{agentId}` — automatic
- MCP: `/api/mcp/{mcpServerKey}/mcp` — via `MCPServer` instance in `src/mastra/index.ts`
- Studio: `localhost:4111` UI — automatic via `mastra dev`

When adding a new agent:
1. Register it in the `agents` field of the Mastra constructor (gets REST + A2A + Studio automatically)
2. Add it to the `agents` field of the `MCPServer` instance (exposes via MCP)
3. Ensure the agent has a non-empty `description` property — MCPServer fails to start without it

The `MastraEditor` instance gives non-developers a way to iterate on agent prompts and tools without code changes. Changes are versioned and stored in the `editor` storage domain. The editor is mandatory for every template in this family.
```

## What to capture in PROGRESS.md

```
## Base Polish 03: Verify + Document Reachability
- Status: complete
- Endpoints verified:
  - REST: <pass | fail>
  - A2A: <pass | fail with details>
  - MCP: <pass | fail with details>
  - Studio + Editor: <pass | fail with details>
- README updated with "Reachability" section
- AGENTS.md updated with "Reachability conventions" section
- Notes: <any endpoint that didn't respond as expected>
```

Move on to Polish 04.
