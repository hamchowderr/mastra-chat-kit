# Harness Events Reference — `AgentControllerEvent` (all 50)

> Grounded in the **installed** declarations, not docs:
> `@mastra/core@1.52.1` — `dist/agent-controller/types.d.ts` (the `AgentControllerEvent` union, lines 537–804).
> Reducer under test: `packages/web/lib/harness/events.ts` (`reduceHarnessEvent`).

The Agent Harness (`AgentController`, formerly `Harness`) drives the same `chatAgent` the Single
Agent path uses, but through a **session** that emits a rich orchestration surface a bare AI SDK
stream can't carry: sessions/threads, modes, model switching, tool-approval gates (HITL),
subagents, tasks, goals, observational memory, and a canonical display state.

`session.subscribe()` forwards **all 50** event types unfiltered over the server's
`POST /harness/stream` SSE. The web reducer currently **consumes 22 and drops 28**. This file is the
source of truth for what each event means and where it should render.

> **The 28 "dropped" are not 28 bugs.** Of them, only **8 fire in this kit's current config** and are
> worth wiring now (live tool streaming + `model_changed`/`agent_start`); **18 are gated on a feature
> that isn't enabled** (observational memory, extra threads, goals, tool suspend — each owned by a
> `698.x` issue); and **2 are intentionally off** (`state_changed`, `display_state_changed`). Subagents
> (`698.27`) and modes (`mode_changed`, `698.28`) have graduated to *consumed*. See the grouped
> roadmap below.

> ✅ **`mastra-chat-kit-vud` (fixed 2026-07-25):** the harness tool flow works with OpenAI. An earlier
> "hangs on every tool call (`generationCount:0`)" symptom was **not** upstream — it was `TokenLimiter`
> in this kit's `defaultOutputProcessors` breaking tool-call streaming (removed in commit `d290068`).
> Note: tool calls are **gated by default** — the AgentController emits `tool_approval_required` and
> pauses until the UI's `Confirmation` element approves (see rows 13/17 below).

## Legend
- **Consumed** — a `case` in `reduceHarnessEvent` folds it into the transcript today.
- **Dropped** — hits `default: return state`; the payload is on the wire but nothing renders it.
- **Target element** — the AI Element (`packages/web/components/ai-elements/*`) that should render it. See [ai-elements.md](./ai-elements.md).

## The 50 events

| # | event type | payload (key fields) | meaning | reducer | target element |
|---|---|---|---|---|---|
| 1 | `mode_changed` | `modeId`, `previousModeId` | Session switched controller mode | ✅ consumed | `ModeSwitcher` |
| 2 | `model_changed` | `modelId`, `scope?`, `modeId?` | Active LLM changed at a scope | ⛔ dropped | `ModelSelector` (reflect) |
| 3 | `thread_changed` | `threadId`, `previousThreadId` | Active thread switched | ⛔ dropped | conversation sidebar |
| 4 | `thread_created` | `thread` (`id`, `title?`, …) | New thread created | ⛔ dropped | conversation sidebar |
| 5 | `thread_deleted` | `threadId` | Thread deleted | ⛔ dropped | conversation sidebar |
| 6 | `state_changed` | `state`, `changedKeys[]` | Controller state object mutated | ⛔ dropped | custom (`data-*`) |
| 7 | `agent_start` | *(none)* | An agent run began | ⛔ dropped | streaming indicator (`Shimmer`) |
| 8 | `agent_end` | `reason?` (`complete`/`aborted`/`error`/`suspended`) | Run finished | ✅ consumed | clears approval, `running=false` |
| 9 | `message_start` | `message: MastraDBMessage` | Message began streaming | ✅ consumed | `Message` (`upsertMessage`) |
| 10 | `message_update` | `message` | Message updated w/ new parts | ✅ consumed | `Message` |
| 11 | `message_end` | `message` | Message finished (final form) | ✅ consumed | `Message` |
| 12 | `tool_start` | `toolCallId`, `toolName`, `args` | Tool call started | ⛔ dropped | `Tool` (`input-available`) |
| 13 | `tool_approval_required` | `toolCallId`, `toolName`, `args` | Tool gated, awaiting approval | ✅ consumed | `Confirmation` |
| 14 | `tool_suspended` | `toolCallId`, `toolName`, `args`, `suspendPayload`, `resumeSchema?` | Tool `suspend()`ed (e.g. `ask_user`) | ⛔ dropped | `Confirmation` / prompt |
| 15 | `tool_suspension_cancelled` | `toolCallId`, `toolName`, `reason` | Parked suspension cancelled | ⛔ dropped | `Tool` status |
| 16 | `tool_update` | `toolCallId`, `partialResult` | Incremental tool result | ⛔ dropped | `Tool` (`ToolOutput` streaming) |
| 17 | `tool_end` | `toolCallId`, `result`, `isError`, `providerMetadata?` | Tool completed | ✅ consumed | `Tool` (`ToolOutput`) |
| 18 | `tool_input_start` | `toolCallId`, `toolName` | Model began streaming tool args | ⛔ dropped | `Tool` (`input-streaming`) |
| 19 | `tool_input_delta` | `toolCallId`, `argsTextDelta`, `toolName?` | Chunk of streamed tool-arg text | ⛔ dropped | `Tool` (`ToolInput` live) |
| 20 | `tool_input_end` | `toolCallId` | Tool-arg streaming finished | ⛔ dropped | `Tool` (`input-available`) |
| 21 | `shell_output` | `toolCallId`, `output`, `stream` (`stdout`/`stderr`) | Sandbox shell chunk | ✅ consumed | `Terminal` (appends) |
| 22 | `usage_update` | `usage: TokenUsage` | Cumulative token usage updated | ✅ consumed | `Context` |
| 23 | `info` | `message` | Informational status message | ✅ consumed | info status line |
| 24 | `error` | `error`, `errorType?`, `retryable?`, `retryDelay?` | Error during the run | ✅ consumed | toast / error line |
| 25 | `follow_up_queued` | `count`, `runId?` | Messages queued while busy | ✅ consumed | `Queue` |
| 26 | `workspace_status_changed` | `status` (`pending`…`destroyed`), `error?` | Workspace lifecycle status | ✅ consumed | workbench status dot |
| 27 | `workspace_ready` | `workspaceId`, `workspaceName` | Workspace initialized | ✅ consumed | workbench status dot |
| 28 | `workspace_error` | `error` | Workspace failed | ✅ consumed | workbench status dot |
| 29 | `om_status` | window/threshold snapshot, `recordId`, `threadId`, `stepNumber`, `generationCount` | Observational-Memory snapshot | ⛔ dropped | Memory panel / `Context` |
| 30 | `om_observation_start` | `cycleId`, `operationType`, `tokensToObserve` | OM observation started | ⛔ dropped | Memory panel |
| 31 | `om_observation_end` | `cycleId`, `durationMs`, `tokensObserved`, `observations?`, … | OM observation done | ⛔ dropped | Memory panel |
| 32 | `om_observation_failed` | `cycleId`, `error`, `durationMs` | OM observation failed | ⛔ dropped | Memory panel |
| 33 | `om_reflection_start` | `cycleId`, `tokensToReflect` | OM reflection (compression) start | ⛔ dropped | Memory panel |
| 34 | `om_reflection_end` | `cycleId`, `durationMs`, `compressedTokens`, `observations?` | OM reflection done | ⛔ dropped | Memory panel |
| 35 | `om_reflection_failed` | `cycleId`, `error`, `durationMs` | OM reflection failed | ⛔ dropped | Memory panel |
| 36 | `om_model_changed` | `role` (`observer`/`reflector`), `modelId` | OM backing model changed | ⛔ dropped | Memory panel |
| 37 | `om_buffering_start` | `cycleId`, `operationType`, `tokensToBuffer` | OM began buffering | ⛔ dropped | Memory panel |
| 38 | `om_buffering_end` | `cycleId`, `operationType`, `tokensBuffered`, `bufferedTokens`, … | OM buffering done | ⛔ dropped | Memory panel |
| 39 | `om_buffering_failed` | `cycleId`, `operationType`, `error` | OM buffering failed | ⛔ dropped | Memory panel |
| 40 | `om_activation` | `cycleId`, `chunksActivated`, `tokensActivated`, … | Buffered OM activated into context | ⛔ dropped | Memory panel |
| 41 | `om_thread_title_updated` | `cycleId`, `threadId`, `oldTitle?`, `newTitle` | OM auto-titled the thread | ⛔ dropped | conversation sidebar |
| 42 | `subagent_start` | `toolCallId`, `agentType`, `task`, `modelId`, `forked?` | Subagent spawned | ✅ consumed | `Agent` (`SubagentCard`) |
| 43 | `subagent_text_delta` | `toolCallId`, `agentType`, `textDelta` | Subagent streaming text | ✅ consumed | `Agent` (streamed text) |
| 44 | `subagent_tool_start` | `toolCallId`, `agentType`, `subToolName`, `subToolArgs` | Subagent tool call started | ✅ consumed | `Agent` › `Tool` |
| 45 | `subagent_tool_end` | `toolCallId`, `agentType`, `subToolName`, `subToolResult`, `isError` | Subagent tool call done | ✅ consumed | `Agent` › `Tool` |
| 46 | `subagent_end` | `toolCallId`, `agentType`, `result`, `isError`, `durationMs` | Subagent finished | ✅ consumed | `Agent` (result) |
| 47 | `subagent_model_changed` | `modelId`, `scope`, `agentType?` | Subagent model changed | ✅ consumed | `Agent` header |
| 48 | `task_updated` | `tasks: TaskItemSnapshot[]` | Structured task list replaced | ✅ consumed | `Task` |
| 49 | `goal_evaluation` | `payload` (`objective`, `iteration`, `maxRuns`, `passed`, `status`, `results[]`, …) | Goal scored by the judge | ⛔ dropped | `Plan` / goal card |
| 50 | `display_state_changed` | `displayState` (aggregate; `Map` fields → `{}` in JSON) | Canonical display-state snapshot | ⛔ dropped | *(intentionally unused over the wire — see note)* |

### Transport sentinels (not part of the union, but the reducer handles them)
- `__thread__` → sets `threadId` so the client can continue the conversation.
- `__done__` → sets `done: true`, clears `pendingApproval`, stops the terminal spinner.

### Why `display_state_changed` is dropped on purpose
Its richest fields (`activeTools`, `toolInputBuffers`, `activeSubagents`, `pendingSuspensions`,
`modifiedFiles`) are JS `Map`s, which serialize to `{}` over JSON. The UI is therefore driven off the
**granular plain-object events** (rows 1–49) instead of the aggregate snapshot.

## Consumed (22)
`agent_end`, `message_start`, `message_update`, `message_end`, `tool_approval_required`, `tool_end`,
`shell_output`, `usage_update`, `error`, `follow_up_queued`, `task_updated`,
`workspace_ready`, `workspace_status_changed`, `workspace_error`, `info`, `mode_changed`,
`subagent_start`, `subagent_text_delta`, `subagent_tool_start`, `subagent_tool_end`, `subagent_end`,
`subagent_model_changed`
_(`workspace_*` + `info` in `698.24`; `subagent_*` in `698.27` — verified end-to-end by an AIMock
integration test (the fixture calls the `subagent` tool, the spawned subagent responds);
`mode_changed` in `698.28` — Chat/Plan switcher, verified `listModes`+`switch` emit it.)_

## Dropped (28) — grouped by whether they can fire in this kit

### A. Fires now — worth wiring (8)
- **Live tool streaming (6):** `tool_start`, `tool_input_start`, `tool_input_delta`, `tool_input_end`,
  `tool_update`, `tool_suspension_cancelled` → `Tool` (`input-streaming` state + live `ToolInput`).
  Fires on every gated tool call. Owned by **`698.25`** (needs event-order capture to avoid
  double-rendering against the settled message-part tool_call).
- **`model_changed` (1):** fires when the composer switches the run's model → reflect in `ModelSelector`.
  Deferred: the composer's own selector already shows the active model, so this only adds a server echo.
- **`agent_start` (1):** run began → a `Shimmer`. Deferred: redundant with the existing streaming indicator.

### B. Gated on a feature that isn't enabled yet (18)
These never fire in the current no-OM config — wiring them now is dead code. Each is owned by the
issue that would turn the feature on. _(Subagents graduated out of this bucket in `698.27`, and
`mode_changed` in `698.28` — both are wired above.)_
- **Observational memory (13):** `om_status` + all `om_*` → a Memory panel + `Context`. Gated on **`698.20`**.
- **Threads/sessions (3):** `thread_changed/_created/_deleted` → conversation sidebar. Gated on
  persistence + **`698.16`/`698.17`**. (`om_thread_title_updated` counts under OM above.)
- **`goal_evaluation` (1):** no goals configured → `Plan`/goal card once goals exist.
- **`tool_suspended` (1):** no suspending tool (`ask_user`) configured → `Confirmation` prompt when one is.

### C. Intentionally off (2)
- **`state_changed`** → aggregate `data-*`; redundant with the granular events.
- **`display_state_changed`** → its `Map` fields serialize to `{}` over JSON (see note above).

See [coverage.md](./coverage.md) for the end-to-end matrix and the Single Agent (AI SDK v7) path.
