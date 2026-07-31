# Coverage Matrix — Agent Controller → AI Elements

> **Companion references:**
> - [agent-controller.md](./agent-controller.md) — the engine, in Mastra's vocabulary.
> - [agent-controller-events.md](./agent-controller-events.md) — all **50** `AgentControllerEvent`
>   types (37 consumed, 13 dropped), with payloads and target elements.
> - [ai-elements.md](./ai-elements.md) — all **48** vendored AI Elements.
>
> **In-product companion:** the app serves a browsable version of this mapping at **`/events`**,
> driven by `packages/web/lib/agent-controller-event-map.ts`. `tests/events.test.tsx` reads the
> real component sources and fails the build if the map names an element the chat UI never
> imports, so `/events` cannot drift into a docs lie.

> Grounded in the **installed** declarations, not docs:
> `@mastra/core@1.52.1`, `ai@7.0.37`, `@ai-sdk/react@4.0.40`, `ai-elements` (48 modules).
>
> Purpose: prove that **everything the agent can emit has a place to render**, and track
> exactly what is wired vs. still pending.

Legend — ✅ wired & rendered · 🟡 event streamed but not yet rendered · ⛔ not consumed.

---

## Agent Controller event → element

The controller emits **50** `AgentControllerEvent` types plus a canonical
`display_state_changed` snapshot. The web reducer **consumes 37 and drops 13** — see
[agent-controller-events.md](./agent-controller-events.md) for the full per-event table.
The 13 dropped are not 13 gaps: 8 are redundant with another surface, 3 are gated on a
feature that isn't enabled, and 2 are intentionally off.

Most of these events do **not** fit a standard AI SDK `UIMessage` part — that is the whole
reason this kit exists. They ride the controller event stream instead, and every one has a
natural element target.

> `display_state_changed` is intentionally **not** used over the wire: its `Map` fields
> (`activeTools`, `activeSubagents`, …) serialize to `{}` in JSON, so the UI is driven off
> the granular plain-object events.

| Controller event | Element target | Wired |
|---|---|---|
| `message_start/_update/_end` (`AgentControllerMessage`) | `Message` / `MessageResponse` | ✅ (handles the v4-nested `tool-invocation` shape core 1.52 emits — `698.26`) |
| message content `text` / `thinking` / `tool_call`+`tool_result` | `MessageResponse` / `Reasoning` / `Tool` | ✅ |
| `tool_start/_input_*/_update/_end` + `ActiveToolState` | `Tool` | ✅ (live input-streaming `<Tool>` via `activeTools`, suppressed once the settled message part lands — `698.25`) |
| `tool_approval_required` + `pendingApproval` | `Confirmation` | ✅ (approve/deny → `POST /agent-controller/approve`) |
| `tool_suspended` / `tool_suspension_cancelled` | `AskUserPrompt` | ✅ (agent-driven `ask_user`; answer → `POST /agent-controller/answer`, `698.30`) |
| `shell_output` (stdout/stderr) | `Terminal` | ✅ (`698.24`) |
| `subagent_start/_text_delta/_tool_*/_end` | `Agent` (+ nested `Tool`) | ✅ (`SubagentCard`, `698.27`) |
| `task_updated` (`TaskItemSnapshot[]`) | `Task` | ✅ (agent's native `TaskSignalProvider`, `698.19`) |
| `goal_evaluation` (`objective`, `iteration`, `passed`, …) | `GoalCard` | ✅ (`698.29`) |
| `follow_up_queued` | `Queue` | ✅ |
| `agent_start` | `Shimmer` | ✅ |
| `mode_changed` | `ModeSwitcher` (composer dropdown) | ✅ (`698.28`) |
| `subagent_model_changed` | `Agent` header | ✅ |
| `usage_update` (`TokenUsage`) | `Context` | ✅ |
| `thread_created/_changed/_deleted` | conversation sidebar | ✅ (sidebar refetches on run-settle; **semantic** search over message bodies via the fastembed index — `698.16`) |
| `workspace_status_changed`/`_ready`/`_error` | status dot / workbench panel | ✅ (`698.24`) |
| `om_*` (observational memory) | Memory panel | ✅ (`698.20` enable, `698.35` render) |
| message content `image` / `file` | `Image` | ✅ |
| `info` | info status line | ✅ |
| `error` | error line / toast (`sonner`) | ✅ |
| `model_changed` | `ModelSelector` (reflect) | ⛔ (composer already shows the active model) |
| `background-task-*` | `Task` / `Tool` (status) | ⛔ |
| checkpoints (thread snapshots) | `Checkpoint` | ⛔ |
| `state_changed` / `state_signal` / `reactive_signal` | custom (`data-*`) | ⛔ (intentional) |

---

## Capability log — what is wired, and how it was verified

- ✅ **HITL approval:** the controller gates tool calls by default → `Confirmation` renders →
  approve/deny POSTs `/agent-controller/approve` → `session.respondToToolApproval` resumes the
  parked run on the still-open SSE. Verified live (approve → tool runs → completes; decline →
  run ends).
- ✅ **Workspace + shell** (`698.24`) and **workspace on the agent** (`698.31`) with native
  per-tool approval config (`698.21`): the shared `Workspace` (filesystem + sandbox + browser,
  one instance in `lib/workspace.ts`) is attached to `chatAgent` so Mastra Studio surfaces
  `workspaceId` + 12 `workspaceTools` (verified live via `/api/agents/chat`). Per-tool policy:
  `write_file`/`edit_file` `requireReadBeforeWrite`, `delete` `requireApproval`. Tests force it
  off (`AGENT_WORKSPACE=false`); the controller still supplies its own.
- ✅ **Live tool-input streaming** (`698.25`): `tool_input_start`/`_delta`/`_end`/`tool_start`
  fold into `transcript.activeTools` → an input-streaming `<Tool>`, suppressed the moment the
  settled `message_update` tool-call part with the same id lands (no double-render). Captured
  order: `tool_input_start → _delta×N → _end → tool_start → message_update[tool-invocation] →
  gate`, so the live state mainly shows on slow/large-arg generations. `reduce.test.ts` covers
  the merge (5 cases).
- ✅ **Subagents** (`698.27`), **modes** (`698.28`), **goals** (`698.29`).
- ✅ **Agent-driven `ask_user`** (`698.30`): an ambiguous request → the agent calls the built-in
  `ask_user` (auto-allowed, no approval gate) → the run suspends → `AskUserPrompt` renders the
  question/options → the answer POSTs `/agent-controller/answer` → `respondToToolSuspension`
  resumes the parked run. Verified live vs OpenAI.
- ✅ **Native task tracking** (`698.19`): the agent registers `TaskSignalProvider` (four task
  tools + `TaskStateProcessor`); a multi-step request → `task_write` (auto-allowed) → the
  processor emits `task_updated` → the `<Task>` element. Verified live vs OpenAI.
- ✅ **Recurring schedules** (`698.18`): `start_schedule` / `stop_schedule` / `list_schedules`
  wrap the native `mastra.schedules` service (persisted to libSQL; the scheduler auto-starts on
  first create and resumes persisted agent schedules on boot — no explicit `scheduler` config).
  `list_schedules` is auto-allowed (read-only); `start_schedule`/`stop_schedule` stay gated (a
  recurring background run is a real side effect). A read-only Schedules workbench tab renders
  the live list (`GET /agent-controller/schedules`), refetched when a run settles.
- ✅ **Observational memory** (`698.20` / `698.35`): `observationalMemory` on the shared memory
  (model gated on `env.CHAT_MODEL`, `scope: 'resource'`, threshold lowered to 3000 tokens for
  demo visibility, env-toggle `OBSERVATIONAL_MEMORY` default-on / off in tests). The Memory
  panel renders the token windows and lifecycle. Confirmed recording real observations
  cross-conversation.
- ✅ **Sidebar semantic search** (`698.16`): `/agent-controller/threads/search` embeds the query
  with fastembed (local, no API spend) and queries the shared `memory_messages_384` vector index
  filtered to `CHAT_RESOURCE_ID`, matching message **bodies** — not just titles. Controller
  messages are already embedded there via `createDefaultMemory`'s `semanticRecall`.

---

## Real-model run — every agent-emittable element verified ✅

Run on a real model (`CHAT_MODEL=anthropic/claude-haiku-4-5` with extended **thinking** enabled
via `defaultOptions.providerOptions.anthropic.thinking`), AIMock off, keys via Infisical.

| Element | How it's produced |
|---|---|
| Response (text) | model text |
| Reasoning | Anthropic extended thinking |
| Tool | `getWeather` / `searchKnowledge` / `generateImage` + the workspace tools |
| Sources + InlineCitation | `searchKnowledge` results mapped via `tool-views` |
| Image | `generateImage` tool (OpenAI `gpt-image-1-mini`, WebP/low) |
| Confirmation | the controller approval gate (every side-effecting tool) |
| Task | `task_write` → `task_updated` |
| Plan | `submit_plan` → `{title, plan}` |
| ChainOfThought | the real tool-call sequence (`StepTrace`) |
| Terminal | `execute_command` (real `execa` in the sandbox) stdout/stderr |
| File Tree | the workspace file listing |
| Code Block | `read_file` / `write_file` / `edit_file` |
| Context | `usage_update` token totals |
| Queue | a follow-up submitted while a run streams |
| Shimmer | `agent_start` → thinking indicator |

**Image architecture (important):** a full image base64 (~2MB PNG) overflows the model context
and trips the output `TokenLimiter`. So `generateImage` returns only a tiny **`imageId`**; the
bytes are stashed in an in-process store and served via `GET /images/:id` (web proxy
`/api/images/:id`), and `GeneratedImage` fetches them into the `<Image>` element. The image
never enters the model context.

## Known gaps

- **Web Preview** — vendored but **not** imported by the chat UI. The Browser panel screencasts
  the real workspace Chrome instead, which supersedes an iframe. Reusing `WebPreview`'s
  navigation shell in `workbench-browser.tsx` (which hand-rolls a URL chip) is a possible
  follow-up.
- **Checkpoint, background-task events** — no producer wired yet.
- **Voice + Workflow canvas** — vendored only; they need a voice pipeline / workflow-viz
  surface this kit doesn't ship.
- **Test Results / Stack Trace** — the workspace tools return unstructured text, so faking
  structured suites/frames would be unreliable.
