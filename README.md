# mastra-chat-kit

One canonical AI chat layer — **Vercel AI Elements + AI SDK v6 + Mastra** — that:

- exercises **every** AI Element and **every** prop (see `packages/web/app/showcase`),
- works in **Agent mode** (bare `Agent`, stateless) *or* **Harness mode** (session-controlled: modes, tool approvals, subagents, model switching, follow-ups),
- is **AIMock-first tested** (test everything before spending money — real API only at Tier 4),
- ships as an **ai-elements / shadcn registry** so every project installs the same thing instead of drifting.

## Structure

```
packages/
├── server/   # Mastra (from mastra-base): agents, Harness, Memory, all @mastra/* packages, AIMock fixtures
│             #   routes: /chat/:agent (Agent mode) + /harness/{chat,stream} (Harness mode, SSE)
└── web/      # Next.js 16 App Router + AI Elements
              #   components/chat (canonical shell, tool-renderer registry, one approval component)
              #   lib/transports/{httpAgent,harness,ipc}.ts (the swappable engine — one file each)
              #   app/showcase (every element + prop)
```

The web layer is pure frontend and talks to the server over a `ChatTransport`; only the transport changes between Agent and Harness mode. `useChat` + AI Elements stay constant.

## Two modes

| | Agent mode | Harness mode |
|---|---|---|
| Backend | `agent.stream` → `toAISdkStream` → `createUIMessageStreamResponse` | `Harness` singleton; commands in, `display_state_changed` snapshots out (SSE) |
| Transport | `DefaultChatTransport` (HTTP) | `harnessTransport` (command POST + SSE → `UIMessageChunk`) |
| Modes / approvals / subagents | n/a | first-class |

## Testing (AIMock first — see vault: "LLM Dev Principle — Mastra + AIMock First")

| Tier | Command | Costs $ |
|---|---|---|
| 1 unit/integration (Vitest + AIMock) | `pnpm test` | no |
| 1.5 evals (`@mastra/evals` + AIMock) | `pnpm --filter server eval` | no |
| component — per element (Vitest + RTL) | `pnpm --filter web test` | no |
| 2 live DB | `pnpm --filter server test:live` | no |
| 3.5 e2e (Playwright, AIMock-backed) | `pnpm test:e2e` | no |
| 4 real provider (no AIMock) | `pnpm --filter server test:sdk` | **yes** |

> Status: scaffolding. See vault note `1. Projects/Mastra Chat Kit/Mastra Chat Kit.md` for the full design + audit.
