# The Agent Controller

This kit ships **one engine**: Mastra's **Agent Controller**. This doc defines it using
Mastra's own vocabulary, and shows how the kit wires each concept to a UI surface.

> **On the name.** Mastra's session controller shipped originally as `Harness` and was
> renamed to **`AgentController`** (module `@mastra/core/agent-controller`) in
> `@mastra/core@1.47.0`; `Harness` survives only as a deprecated alias. Mastra's docs
> call it **Agent Controller** exclusively, and so does this repo — routes
> (`/agent-controller/stream`), files (`lib/agent-controller.ts`, `lib/agent-controller/`),
> and prose.

## Why a controller instead of `agent.stream`

A bare `agent.stream` gives you an AI SDK `UIMessage` stream: text, reasoning, tool
parts. That is enough for a chat box and nothing more. The controller wraps the **same**
`chatAgent` and adds the orchestration a plain message stream cannot carry:

| | bare `agent.stream` | the Agent Controller |
|---|---|---|
| Shape | stateless request → response stream | stateful session per conversation |
| Wire format | AI SDK `UIMessage` parts | `AgentControllerEvent`s (50 types) over SSE |
| Tool execution | runs immediately | gated behind approvals (HITL) |
| Also carries | — | threads, modes, subagents, goals, tasks, schedules, observational memory, a live workspace |

> **This kit previously shipped both.** A second "Agent mode" wrapped `agent.stream`
> directly. It was mounted nowhere, had no e2e coverage, and its only unit test rendered
> an empty shell — so a consumer installing it would have been the first person to run
> it. It was removed rather than shipped unverified (`bd mastra-chat-kit-eg1`).

## The concepts (Mastra's terms)

- **Session** — *"the per-conversation runtime state that tracks the active mode,
  model, thread binding, permission grants, follow-up queue, and token usage."* This kit
  keeps one process-wide Session per logical user (`getChatSession()`).
- **Thread** — persists a conversation and its structured state *"across sessions,
  users, and mode switches."* Threads keep separate conversations separate.
- **Mode** — *"distinct agent personalities (instructions, tools, model)"* you can
  *"switch between without losing conversation context."* This kit ships a single
  `default` mode; add more to demonstrate mode-switching.
- **Tool approvals (HITL)** — *"require confirmation for risky operations like file
  writes or deployments,"* with the ability to *"grant session-wide exceptions, and
  handle interactive tool suspension."* A gated tool call **parks** the run and emits an
  approval request; the UI answers via `/agent-controller/approve`.
- **Subagents** — *"focused child agents with constrained tools for subtasks,
  optionally forking the parent conversation."*
- **Display state** — the controller emits coalesced **`AgentControllerDisplayState`**
  snapshots (as `AgentControllerEvent`s) *"to drive your UI."*

## How the kit wires it

**Server** (`packages/server/src/mastra/lib/agent-controller.ts` + `index.ts`):
`getChatSession()` builds/reuses an `AgentController` (one `default` mode wrapping
`chatAgent`, plus the required `Workspace`) and gets-or-creates its `Session`.
`POST /agent-controller/stream` subscribes to the Session, sends the user message, and
streams each `AgentControllerEvent` as SSE. `POST /agent-controller/approve` resolves a
parked approval gate, and `POST /agent-controller/answer` resolves an `ask_user`
suspension — both on the same still-open stream.

The `Workspace` is what makes this a batteries-included agent rather than a chat loop.
It bundles three capabilities, each auto-deriving its own approval-gated tools:

- **Filesystem** (`LocalFilesystem`, rooted at `WORKSPACE_ROOT`) — read / write / edit /
  list / delete / search files.
- **Shell sandbox** (`LocalSandbox`) — `executeCommand`, real commands via `execa`.
- **Browser** (`BrowserViewer` from `@mastra/browser-viewer`) — a Playwright-managed
  Chrome. It injects its CDP URL into the CLI the agent shells out to (`agent-browser`
  by default), so shell-driven *and* native browser tools drive the same window. Chrome
  launches **lazily** on first browser tool use — nothing spawns at boot. Configure via
  `BROWSER_CLI` / `BROWSER_HEADLESS` / `BROWSER_EXECUTABLE_PATH`.

This is also how **web search** works: the composer's Search toggle sets a `webSearch`
request-context flag, and the agent browses the live web with those browser tools — the
user watches it happen in the Browser panel. No provider-executed `web_search` tool is
involved, because `@mastra/core`'s loop cannot forward provider-executed results.

**Web** (`packages/web/lib/agent-controller/`): `useAgentControllerChat` mirrors
`useChat`'s `{ messages, sendMessage, status }` shape but speaks SSE, folding each event
into a transcript via `reduceAgentControllerEvent` (`lib/agent-controller/events.ts`).
The shell renders that transcript onto stock AI Elements.

## References (Mastra docs)

- Agent Controller overview: <https://mastra.ai/docs/agent-controller/overview>
- Agent Controller class reference: <https://mastra.ai/reference/agent-controller/agent-controller-class>
- Session class: <https://mastra.ai/reference/agent-controller/session>
- Workspaces: <https://mastra.ai/blog/introducing-mastra-workspaces>
