# Agent mode & Harness mode

mastra-chat-kit runs the **same** chat UI (the AI Elements + `useChat` surface) two
ways. Only the client-side wiring and the server route change; the components don't.
This doc defines both, using Mastra's own vocabulary.

> **A note on names.** Mastra's session controller was originally shipped as
> **`Harness`** and was renamed to **`AgentController`** (module
> `@mastra/core/agent-controller`) in `@mastra/core@1.47.0`; `Harness` remains a
> deprecated alias. The current Mastra docs call it **AgentController** exclusively.
> This kit still uses the `harness` name for its routes (`/harness/stream`), files
> (`lib/harness.ts`, `lib/harness/`), and the "Harness mode" label — so throughout
> this repo, **"Harness mode" means "driven by Mastra's AgentController."**

## TL;DR

| | 🟢 Agent mode | 🟣 Harness mode |
|---|---|---|
| Mastra primitive | the **Agent** class directly (`agent.stream`) | the **AgentController** (a Session per conversation) |
| Shape | stateless request → response stream | stateful session: modes, approvals, subagents |
| Server route | `POST /chat/:agentId` | `POST /harness/stream` (SSE) + `POST /harness/approve` |
| Wire format | AI SDK `UIMessage` parts | `AgentControllerEvent`s → `AgentControllerDisplayState` |
| Web client | `useChat` + `singleAgentTransport` | `useHarnessChat` hook |
| Reach for it when | plain streaming chat | you need modes / tool approvals / subagents / model-switch / follow-ups |

---

## Agent mode — the bare Agent

Agent mode uses a Mastra **Agent** directly. Per the Mastra docs, you reach for
"the Agent class directly when you want full control or a request-response call."
It's **stateless per request** and streams standard AI SDK `UIMessage` parts.

**Server** (`packages/server/src/mastra/index.ts`): the `chatRoute` calls
`agent.stream(...)` → `toAISdkStream(...)` → `createUIMessageStreamResponse(...)`,
exposed at `POST /chat/:agentId`.

**Web** (`packages/web`): the chat shell calls
`useChat({ transport: singleAgentTransport(agentId) })`, where
`singleAgentTransport` (`lib/transports/single-agent.ts`) is a
`DefaultChatTransport` pointed at the same-origin proxy `/api/chat/:agentId`, which
forwards to the server.

Use Agent mode for straightforward streaming chat where you don't need session
orchestration.

---

## Harness mode — Mastra's AgentController

Harness mode is built on Mastra's **AgentController** — *"a session controller for
building interactive agent applications that handles the runtime concerns that sit
between your UI and the agent loop: managing conversation threads, switching between
agent modes, persisting state, gating tool execution with approvals, and
coordinating subagents."* It wraps the **same** `chatAgent` Agent mode uses, but adds
the orchestration surface a plain `UIMessage` stream can't carry.

### The concepts (Mastra's terms)

- **Session** — *"the per-conversation runtime state that tracks the active mode,
  model, thread binding, permission grants, follow-up queue, and token usage."* In
  this kit there is one process-wide Session per logical user (`getChatSession()`).
- **Thread** — persists a conversation and its structured state *"across sessions,
  users, and mode switches."* Threads keep separate conversations separate.
- **Mode** — *"distinct agent personalities (instructions, tools, model)"* you can
  *"switch between without losing conversation context."* This kit ships a single
  `default` mode; add more to demonstrate mode-switching.
- **Tool approvals (HITL)** — *"require confirmation for risky operations like file
  writes or deployments,"* with the ability to *"grant session-wide exceptions, and
  handle interactive tool suspension."* A tool call **suspends** the run and emits an
  approval request; the UI responds `approve` / `decline` (see `/harness/approve`).
- **Subagents** — *"focused child agents with constrained tools for subtasks,
  optionally forking the parent conversation."*
- **Display state** — the AgentController emits coalesced **`AgentControllerDisplayState`**
  snapshots (as `AgentControllerEvent`s) *"to drive your UI."*

### How the kit wires it

**Server** (`packages/server/src/mastra/lib/harness.ts` + `index.ts`):
`getChatSession()` builds/reuses an `AgentController` (one `default` mode wrapping
`chatAgent`, plus the required `Workspace`) and gets-or-creates its `Session`. The
route `POST /harness/stream` subscribes to the Session, sends the user message, and
streams each `AgentControllerEvent` as SSE; `POST /harness/approve` resolves a parked
tool-approval gate on the same Session.

**Web** (`packages/web/lib/harness/`): the `useHarnessChat` hook mirrors `useChat`'s
`{ messages, sendMessage, status }` shape but speaks the SSE protocol, folding each
event into a transcript (`reduceHarnessEvent` in `lib/harness/events.ts`). The chat
shell renders that transcript onto the **same** AI Elements as Agent mode.

Use Harness mode when you need any of: **modes**, **tool approvals**, **subagents**,
**model switching**, or **queued follow-ups**.

---

## Which mode should I use?

- **Just streaming a chat?** → Agent mode. Less moving parts, stateless, standard
  AI SDK `useChat`.
- **Need to gate tools behind approval, run subagents, switch modes/models mid-chat,
  or queue follow-ups?** → Harness mode.

Both share one backend agent and one UI — swapping between them is a client-wiring
change, not a rewrite.

## References (Mastra docs)

- Agent (streaming): <https://mastra.ai/docs/agents/overview>
- AgentController overview: <https://mastra.ai/docs/agent-controller/overview>
- AgentController class reference: <https://mastra.ai/reference/agent-controller/agent-controller-class>
- Workspaces: <https://mastra.ai/blog/introducing-mastra-workspaces>
