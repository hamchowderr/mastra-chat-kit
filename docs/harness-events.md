# Harness Events Reference — `AgentControllerEvent` (all 50)

> Grounded in the **installed** declarations, not docs:
> `@mastra/core@1.52.1` — `dist/agent-controller/types.d.ts` (the `AgentControllerEvent` union, lines 537–804).
> Reducer under test: `packages/web/lib/harness/events.ts` (`reduceHarnessEvent`).

The Agent Harness (`AgentController`, formerly `Harness`) drives the same `chatAgent` the Single
Agent path uses, but through a **session** that emits a rich orchestration surface a bare AI SDK
stream can't carry: sessions/threads, modes, model switching, tool-approval gates (HITL),
subagents, tasks, goals, observational memory, and a canonical display state.

`session.subscribe()` forwards **all 50** event types unfiltered over the server's
`POST /harness/stream` SSE. The web reducer currently **consumes 37 and drops 13**. This file is the
source of truth for what each event means and where it should render.

> **In-product companion:** the browsable version of this table is the **`/events`** page
> (`packages/web/app/events/page.tsx`), driven by `packages/web/lib/harness-event-map.ts` — each event
> links to a live Showroom demo of the AI Element it drives, plus its source. Keep the map, this file,
> and [coverage.md](./coverage.md) in lockstep.

> **The 13 "dropped" are not 13 bugs.** Of them, **8 are OM secondary/redundant** (`om_model_changed`,
> `om_buffering_*`, `om_thread_title_updated`, plus `model_changed`, `agent_start`, `tool_update` — each
> already covered by another surface); **3 are gated on a feature not enabled** (extra thread events,
> the sidebar refetches on run-settle instead); and **2 are intentionally off** (`state_changed`,
> `display_state_changed`). Everything with a first-class UI — observational memory (`698.20`/`698.35`),
> live tool streaming (`698.25`), subagents (`698.27`/`698.32`), modes (`698.28`), goals (`698.29`), the
> `ask_user` suspend flow (`698.30`), tasks (`698.19`), schedules (`698.18`) — is now *consumed*.

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
| 12 | `tool_start` | `toolCallId`, `toolName`, `args` | Tool call started | ✅ consumed (`698.25`) | `Tool` (`input-available`) |
| 13 | `tool_approval_required` | `toolCallId`, `toolName`, `args` | Tool gated, awaiting approval | ✅ consumed | `Confirmation` |
| 14 | `tool_suspended` | `toolCallId`, `toolName`, `args`, `suspendPayload`, `resumeSchema?` | Tool `suspend()`ed (e.g. `ask_user`) | ✅ consumed (`698.30`) | `AskUserPrompt` (→ `POST /harness/answer`) |
| 15 | `tool_suspension_cancelled` | `toolCallId`, `toolName`, `reason` | Parked suspension cancelled | ✅ consumed (`698.30`) | clears `AskUserPrompt` |
| 16 | `tool_update` | `toolCallId`, `partialResult` | Incremental tool result | ⛔ dropped | `Tool` (settled message part already renders the full result) |
| 17 | `tool_end` | `toolCallId`, `result`, `isError`, `providerMetadata?` | Tool completed | ✅ consumed | `Tool` (`ToolOutput`) |
| 18 | `tool_input_start` | `toolCallId`, `toolName` | Model began streaming tool args | ✅ consumed (`698.25`) | `Tool` (`input-streaming`) |
| 19 | `tool_input_delta` | `toolCallId`, `argsTextDelta`, `toolName?` | Chunk of streamed tool-arg text | ✅ consumed (`698.25`) | `Tool` (`ToolInput` live) |
| 20 | `tool_input_end` | `toolCallId` | Tool-arg streaming finished | ✅ consumed (`698.25`) | `Tool` (`input-available`) |
| 21 | `shell_output` | `toolCallId`, `output`, `stream` (`stdout`/`stderr`) | Sandbox shell chunk | ✅ consumed | `Terminal` (appends) |
| 22 | `usage_update` | `usage: TokenUsage` | Cumulative token usage updated | ✅ consumed | `Context` |
| 23 | `info` | `message` | Informational status message | ✅ consumed | info status line |
| 24 | `error` | `error`, `errorType?`, `retryable?`, `retryDelay?` | Error during the run | ✅ consumed | toast / error line |
| 25 | `follow_up_queued` | `count`, `runId?` | Messages queued while busy | ✅ consumed | `Queue` |
| 26 | `workspace_status_changed` | `status` (`pending`…`destroyed`), `error?` | Workspace lifecycle status | ✅ consumed | workbench status dot |
| 27 | `workspace_ready` | `workspaceId`, `workspaceName` | Workspace initialized | ✅ consumed | workbench status dot |
| 28 | `workspace_error` | `error` | Workspace failed | ✅ consumed | workbench status dot |
| 29 | `om_status` | window/threshold snapshot, `recordId`, `threadId`, `stepNumber`, `generationCount` | Observational-Memory snapshot | ✅ consumed (`698.35`) | Memory panel (token windows) |
| 30 | `om_observation_start` | `cycleId`, `operationType`, `tokensToObserve` | OM observation started | ✅ consumed (`698.35`) | Memory panel (activity) |
| 31 | `om_observation_end` | `cycleId`, `durationMs`, `tokensObserved`, `observations?`, … | OM observation done | ✅ consumed (`698.35`) | Memory panel (activity) |
| 32 | `om_observation_failed` | `cycleId`, `error`, `durationMs` | OM observation failed | ✅ consumed (`698.35`) | Memory panel (activity) |
| 33 | `om_reflection_start` | `cycleId`, `tokensToReflect` | OM reflection (compression) start | ✅ consumed (`698.35`) | Memory panel (activity) |
| 34 | `om_reflection_end` | `cycleId`, `durationMs`, `compressedTokens`, `observations?` | OM reflection done | ✅ consumed (`698.35`) | Memory panel (activity) |
| 35 | `om_reflection_failed` | `cycleId`, `error`, `durationMs` | OM reflection failed | ✅ consumed (`698.35`) | Memory panel (activity) |
| 36 | `om_model_changed` | `role` (`observer`/`reflector`), `modelId` | OM backing model changed | ⛔ dropped | Memory panel |
| 37 | `om_buffering_start` | `cycleId`, `operationType`, `tokensToBuffer` | OM began buffering | ⛔ dropped | Memory panel |
| 38 | `om_buffering_end` | `cycleId`, `operationType`, `tokensBuffered`, `bufferedTokens`, … | OM buffering done | ⛔ dropped | Memory panel |
| 39 | `om_buffering_failed` | `cycleId`, `operationType`, `error` | OM buffering failed | ⛔ dropped | Memory panel |
| 40 | `om_activation` | `cycleId`, `chunksActivated`, `tokensActivated`, … | Buffered OM activated into context | ✅ consumed (`698.35`) | Memory panel (activity) |
| 41 | `om_thread_title_updated` | `cycleId`, `threadId`, `oldTitle?`, `newTitle` | OM auto-titled the thread | ⛔ dropped | conversation sidebar |
| 42 | `subagent_start` | `toolCallId`, `agentType`, `task`, `modelId`, `forked?` | Subagent spawned | ✅ consumed | `Agent` (`SubagentCard`) |
| 43 | `subagent_text_delta` | `toolCallId`, `agentType`, `textDelta` | Subagent streaming text | ✅ consumed | `Agent` (streamed text) |
| 44 | `subagent_tool_start` | `toolCallId`, `agentType`, `subToolName`, `subToolArgs` | Subagent tool call started | ✅ consumed | `Agent` › `Tool` |
| 45 | `subagent_tool_end` | `toolCallId`, `agentType`, `subToolName`, `subToolResult`, `isError` | Subagent tool call done | ✅ consumed | `Agent` › `Tool` |
| 46 | `subagent_end` | `toolCallId`, `agentType`, `result`, `isError`, `durationMs` | Subagent finished | ✅ consumed | `Agent` (result) |
| 47 | `subagent_model_changed` | `modelId`, `scope`, `agentType?` | Subagent model changed | ✅ consumed | `Agent` header |
| 48 | `task_updated` | `tasks: TaskItemSnapshot[]` | Structured task list replaced | ✅ consumed | `Task` |
| 49 | `goal_evaluation` | `payload` (`objective`, `iteration`, `maxRuns`, `passed`, `status`, `results[]`, …) | Goal scored by the judge | ✅ consumed | `GoalCard` |
| 50 | `display_state_changed` | `displayState` (aggregate; `Map` fields → `{}` in JSON) | Canonical display-state snapshot | ⛔ dropped | *(intentionally unused over the wire — see note)* |

### Transport sentinels (not part of the union, but the reducer handles them)
- `__thread__` → sets `threadId` so the client can continue the conversation.
- `__done__` → sets `done: true`, clears `pendingApproval`, stops the terminal spinner.

### Why `display_state_changed` is dropped on purpose
Its richest fields (`activeTools`, `toolInputBuffers`, `activeSubagents`, `pendingSuspensions`,
`modifiedFiles`) are JS `Map`s, which serialize to `{}` over JSON. The UI is therefore driven off the
**granular plain-object events** (rows 1–49) instead of the aggregate snapshot.

## Consumed (37)
`agent_end`, `message_start`, `message_update`, `message_end`,
`tool_start`, `tool_input_start`, `tool_input_delta`, `tool_input_end`, `tool_end`,
`tool_approval_required`, `tool_suspended`, `tool_suspension_cancelled`,
`shell_output`, `usage_update`, `error`, `info`, `follow_up_queued`, `mode_changed`,
`workspace_ready`, `workspace_status_changed`, `workspace_error`,
`om_status`, `om_observation_start`, `om_observation_end`, `om_observation_failed`,
`om_reflection_start`, `om_reflection_end`, `om_reflection_failed`, `om_activation`,
`subagent_start`, `subagent_text_delta`, `subagent_tool_start`, `subagent_tool_end`, `subagent_end`,
`subagent_model_changed`, `task_updated`, `goal_evaluation`
_(`workspace_*` + `info` in `698.24`; `subagent_*` in `698.27` (verified by an AIMock integration test);
`mode_changed` in `698.28`; `goal_evaluation` in `698.29`; `tool_suspended`/`tool_suspension_cancelled`
in `698.30` (agent-driven `ask_user`); the `om_*` set in `698.35` (Memory panel — token windows +
observe/reflect/activate activity); the live tool-input set (`tool_start`/`tool_input_*`) in `698.25`
(input-streaming `Tool`, suppressed once the settled message part lands).)_

## Dropped (13) — grouped by why

### A. Already covered by another surface (6)
- **`tool_update`** → the settled `message_update` tool_call part already renders the full result.
- **`model_changed`** → the composer's own model picker already shows the active model.
- **`agent_start`** → redundant with the existing streaming/typing indicator.
- **`om_model_changed`, `om_buffering_*` (buffering start/end/failed)** → the Memory panel surfaces
  `om_status` + observe/reflect/activate; the buffering phase and model swaps aren't shown.

### B. Gated on a feature that isn't enabled yet (4)
- **Threads/sessions (3):** `thread_changed/_created/_deleted` → the conversation sidebar **refetches on
  run-settle** rather than folding these live, so they stay dropped by design.
- **`om_thread_title_updated` (1):** OM auto-titling isn't reflected live; titles come from the manual
  `/threads/:id/title` route (`698.11`).

### C. Intentionally off (2)
- **`state_changed`** → aggregate `data-*`; redundant with the granular events.
- **`display_state_changed`** → its `Map` fields serialize to `{}` over JSON (see note above).

See [coverage.md](./coverage.md) for the end-to-end matrix and the Single Agent (AI SDK v7) path.
