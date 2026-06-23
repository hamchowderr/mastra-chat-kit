# Coverage Matrix — Mastra/Harness → AI SDK v6 → AI Elements

> **Live, browsable version:** the app serves this as a page at **`/status`** (the in-product
> wiring map, sourced from `packages/web/lib/wiring.ts`). Keep that file and this doc in sync.

> Grounded in the **installed** type declarations, not docs:
> `@mastra/core@1.45.0`, `@mastra/ai-sdk@1.5.0`, `ai@6.0.208`, `@ai-sdk/react@3.0.210`, `ai-elements` (48 modules).
>
> Purpose: prove that **everything an agent can emit has a place to render**, and track
> exactly what is wired vs. still pending. This is the spec for the Agent Harness build and
> for keeping the Showroom prop-complete.

Legend — **Wired**: ✅ in the live Single Agent path · 🟡 shown in `/showcase` only (display, no live source yet) · ⛔ not rendered anywhere yet.

---

## 1. AI SDK v6 `UIMessage.parts` → element

The 8 part types `useChat()` can deliver (from `ai@6.0.208`), and what renders each.

| UIMessage part | Element | `chat.tsx` (Single Agent) | Showroom |
|---|---|---|---|
| `text` | `Message` + `MessageResponse` (Streamdown) | ✅ | 🟡 |
| `reasoning` (`state: streaming\|done`) | `Reasoning` | ✅ | 🟡 |
| `tool-${name}` / `dynamic-tool` | `Tool` (+ `Confirmation` for approval states) | ✅ Tool · ⛔ Confirmation | 🟡 Tool + Confirmation |
| `source-url` | `Sources` / `Source` | ✅ | 🟡 |
| `source-document` | `Sources` / `Source` | ✅ | 🟡 |
| `file` (`mediaType`, `url`) | `Image` (image/*) · `Attachment`/file chip (other) | ⛔ | 🟡 (Image) |
| `step-start` | step divider (no dedicated element) | ⛔ | n/a |
| `data-${name}` (custom, optional `transient`) | any element via custom mapping (Task, Plan, Artifact, …) | ⛔ | n/a |

**Tool part states** (discriminated union — all 7): `input-streaming`, `input-available`,
`approval-requested`, `approval-responded`, `output-available`, `output-error`, `output-denied`.
`ToolHeader.state` accepts all 7; `Confirmation` consumes `approval-requested` →
`approval-responded`/`output-denied`. Native HITL carries an `approval { id, approved?, reason?, signature? }`
object (HMAC-SHA256 `signature` guards against client-forged approvals).

---

## 2. Mastra **Single Agent** stream chunk → AI SDK v6 part → element

`@mastra/ai-sdk` (`toAISdkStream`/`handleChatStream`/`chatRoute`, `version:'v6'`) converts Mastra's
native stream into the UIMessage parts above. Representative mapping (Mastra emits ~45 chunk types):

| Mastra chunk | → AI SDK v6 part | Element |
|---|---|---|
| `text-start/-delta/-end` | `text` | `Message`/`MessageResponse` |
| `reasoning-start/-delta/-end`, `reasoning-signature`, `redacted-reasoning` | `reasoning` | `Reasoning` |
| `tool-call`, `tool-call-input-streaming-*`, `tool-call-delta` | `tool-*` (`input-streaming`/`input-available`) | `Tool` |
| `tool-call-approval` | `tool-*` `approval-requested` | `Confirmation` |
| `tool-result` / `tool-error` | `tool-*` `output-available`/`output-error` | `Tool` (`ToolOutput`) |
| `source` (`sourceType: url\|document`) | `source-url` / `source-document` | `Sources` |
| `file` (data/base64, mimeType) | `file` | `Image` / file chip |
| `object` / `object-result` (structured output) | `data-*` | `Artifact` / `CodeBlock` / custom |
| `step-start` / `step-finish` | `step-start` | step divider |
| `finish` / `abort` / `error` | finish/`error` metadata | `PromptInputSubmit` status, toast |
| usage (`LanguageModelV2Usage`: input/output/cached/reasoning tokens) | message metadata | `Context` |

Finish-reason mapping: Mastra's extended `tripwire`/`retry` → AI SDK `other`; standard reasons pass through.

---

## 3. Mastra **Agent Harness** event → element  (the bigger surface)

The Harness emits `HarnessEvent` + a canonical `HarnessDisplayState` (~40 event types). Most do **not**
fit a standard UIMessage part — they ride the Harness event stream (or `data-*`). Every one has a
natural element target.

**Status:** the display path is now wired (server `POST /harness/stream` SSE → web `useHarnessChat`
reducer → `HarnessChat` view on the same elements). Note: `display_state_changed` is intentionally
NOT used over the wire — its `Map` fields (`activeTools`, `activeSubagents`, …) serialize to `{}` in
JSON, so the UI is driven off the granular plain-object events instead. ✅ = wired & rendered, 🟡 =
event mapped/streamed, ⛔ = not consumed yet.

| Harness event / display-state | Element target | Wired |
|---|---|---|
| `message_start/_update/_end` (`HarnessMessage`) | `Message` / `MessageResponse` | ✅ |
| message content `text` / `thinking` / `tool_call`+`tool_result` | `MessageResponse` / `Reasoning` / `Tool` | ✅ |
| `tool_start/_input_*/_update/_end` + `ActiveToolState` | `Tool` | 🟡 (via message tool_call/result) |
| `tool_approval_required` + `pendingApproval` | `Confirmation` | ✅ (approve/deny wired → `POST /harness/approve`) |
| `tool_suspended` / `pendingSuspensions` | `Confirmation` / `Task` | ⛔ |
| `shell_output` (stdout/stderr) | `Terminal` | ⛔ |
| `subagent_start/_text_delta/_tool_*/_end` + `ActiveSubagentState` | `Agent` (+ nested `Tool`/`Task`) | ⛔ |
| `task_updated` (`TaskItemSnapshot[]`) | `Task` / `Plan` / `ChainOfThought` | ✅ (`Task`) |
| `background-task-*` (started/running/progress/completed/failed) | `Task` / `Tool` (status) | ⛔ |
| `mode_changed` | mode badge / `Toolbar` | ⛔ |
| `model_changed` / `subagent_model_changed` | `ModelSelector` | ⛔ |
| `usage_update` (`TokenUsage`) | `Context` | ⛔ |
| `thread_created/_changed/_deleted` | conversation switcher (sidebar) | ⛔ |
| checkpoints (thread snapshots) | `Checkpoint` | ⛔ |
| `workspace_status_changed`/`_ready`/`_error` | status badge / `Panel` | ⛔ |
| `om_*` (observational memory: observe/reflect/buffer/activate) | `ChainOfThought` + `Context` (weakest 1:1 fit) | ⛔ |
| `state_changed` / `state_signal` / `reactive_signal` | custom (`data-*`) | ⛔ |
| message content `image` / `file` | `Image` / file chip | ⛔ |
| `info` / `error` | toast (`sonner`) | ⛔ |

`extractV6NativeApproval()` recovers the `runId` from a v6 `approval-responded` message — the resume hook
for HITL once `Confirmation` is wired to `addToolApprovalResponse`.

---

## 4. Gaps (actionable)

**A. Single Agent renderer (`chat.tsx`)** — small, makes the live path complete:
- render `file` parts (`Image` for image/*, file chip otherwise)
- render tool **approval** states via `Confirmation` (needs a tool that requests approval + `addToolApprovalResponse` wiring)
- handle `step-start` (divider) and `data-*` (custom) parts

**B. Showroom prop completeness** — display-only, no server needed (this PR):
- `Tool` all 7 states · `Confirmation` requested/accepted/denied · `Message` branching ·
  `InlineCitation` carousel · `Plan` `isStreaming` + footer/action · `ChainOfThought` search results ·
  `Conversation` download

**C. Agent Harness display path** — ✅ core wired (beads `sa5`, `8gm` closed):
- server: `getChatHarness()` singleton + `POST /harness/stream` SSE (`src/mastra/lib/harness.ts`, route in `index.ts`)
- web: `useHarnessChat` SSE consumer + `reduceHarnessEvent` reducer + `HarnessChat` view + Single Agent⇄Agent Harness toggle; shared `Composer` so the input never drifts
- ✅ HITL approval: the Harness gates tool calls by default → `Confirmation` renders → approve/deny POSTs `/harness/approve` → `session.respondToToolApproval` resumes the parked run on the still-open SSE. Verified live (approve → tool runs → completes; decline → run ends).
- ✅ live e2e: gate→approve→tool→answer round-trip proven via curl on the running server.
- still ⛔: subagents / shell_output / OM event rendering, and richer fixtures (multi-tool, title-gen)

**D. Server honoring PromptInput body** (beads `mhr`): `model`, `webSearch`, attachments/file parts.

---

## 5. Real-model run — every agent-emittable element verified ✅

Run on a real model (`CHAT_MODEL=anthropic/claude-haiku-4-5` with extended **thinking** enabled
via `defaultOptions.providerOptions.anthropic.thinking`), AIMock off, keys via Infisical. The
single-agent route uses `handleChatStream` with `sendReasoning:true` + `sendSources:true` +
`defaultOptions.maxSteps` (and a `messageMetadata` usage hook + per-request `model`) to surface
reasoning/sources, loop after tools, drive `<Context>`, and honor the model picker.

| Element | Single Agent | Agent Harness | How it's produced |
|---|---|---|---|
| Response (text) | ✅ | ✅ | model text |
| Reasoning | ✅ | ✅ | Anthropic extended thinking |
| Tool | ✅ | ✅ | getWeather / searchKnowledge / generateImage |
| Sources + InlineCitation | ✅ | ✅ | `searchKnowledge` results mapped via `tool-views` |
| Image | ✅ | ✅ | `generateImage` tool (OpenAI `gpt-image-1-mini`, WebP/low) |
| Confirmation | — | ✅ | Harness approval gate (every tool) |
| Task | — | ✅ | Harness `task_write` → `task_updated` |
| Plan | — | ✅ | Harness `submit_plan` → `{title, plan}` |
| ChainOfThought | — | ✅ | the real tool-call sequence (`StepTrace`) |

**Image architecture (important):** a full image base64 (~2MB PNG) overflows the model context and
trips the output `TokenLimiter`. So `generateImage` returns only a tiny **`imageId`**; the bytes are
stashed in an in-process store and served via `GET /images/:id` (web proxy `/api/images/:id`), and
`GeneratedImage` fetches them into the `<Image>` element. The image never enters the model context.

### Middle group — now made real (was dormant/ui-util)
- **Shimmer** — ✅ real: shows while `status==='streaming'` in both chat views.
- **Context** (token usage) — ✅ **live**. The single-agent route uses `handleChatStream` (not the
  `chatRoute` helper) with a `messageMetadata` callback that attaches the finish-step `totalUsage` to
  `message.metadata`; `chat.tsx` renders `<Context>` from the latest assistant message. Verified live:
  `inputTokens:988 outputTokens:109 totalTokens:1097`.
- **Queue** — ✅ **live**. A client-side send queue: submitting while a run streams enqueues the
  message into `<Queue>` and auto-sends it when the run goes idle.
- **Model Selector** — ✅ **live**. The composer now uses the `<ModelSelector>` command palette; the
  choice is sent as `body.model` and honored by the route (validated allow-list → per-request
  `defaultOptions.model`). Verified live: server echoes `model: anthropic/claude-haiku-4-5`.
- **Web Preview** — ✅ **live** (see §7). Iframes the top web-search source URL.
- **Open-in-chat / Checkpoint** — still UI utilities, not agent output (share button, thread-rewind).
  Showroom only.

## 6. Code Agent — the Code category over a Mastra sandbox ✅

`agents/code.ts` is a coding agent whose tools are Mastra's built-in **workspace tools**
(`createWorkspaceTools` over a `LocalFilesystem` + `LocalSandbox` with `isolation:'none'` — the
recommended backend on Windows). It's served by the same `/chat/:agentId` route (agent id `code`,
`maxSteps:12`) and selected via the "Code Agent" mode in the switcher. The workspace tool calls drive
the Code elements with REAL data:

| Element | How it's produced |
|---|---|
| File Tree | `list_files` tree text → parsed into `<FileTree>` |
| Terminal | `execute_command` (real `execa` in the sandbox) stdout/stderr → `<Terminal>` |
| Code Block | `read_file` / `write_file` / `edit_file` → `<CodeBlock>` |

Verified live (real haiku): `/chat/code` ran `list_files`, `write_file`, `execute_command` (exit 0),
`read_file` — it wrote and ran `fib.js` end-to-end, both directly and through the web proxy
`/api/chat/code`. Test Results / Stack Trace stay Showroom — the tools return unstructured text, so
faking structured suites/frames would be unreliable. Voice + the Workflow canvas remain Showroom
(they need a voice pipeline / workflow-viz surface).

## 7. Provider-native web search + Web Preview ✅ (with a Mastra caveat)

The composer's **Search** toggle sends `body.webSearch`. When on, the `/chat/:agentId` route runs the
turn with Anthropic's provider-native web search.

**Caveat (important):** this can't stream through the Mastra agent loop. `@mastra/core@1.45` (the
latest stable — we're already on it; the fix is unreleased, GH #14148/#10327 open) has no
provider-executed/server-hosted tool handling — the loop stops at the `web_search` tool call
(`srvtoolu_` id, `providerExecuted:true`) and never forwards Anthropic's inline result (usage 0, no
sources). Confirmed with both `toolsets` and agent-tool placement.

So **web-search turns bypass the Mastra loop**: the route calls the AI SDK `streamText` directly
(`anthropic(model)` + `anthropic.tools.webSearch_20250305()`), streamed to the SAME v6 UIMessage
transport + elements. Non-search turns still go through Mastra (`handleChatStream`). The tradeoff:
a web-search turn skips Mastra memory/processors (fine for a stateless lookup). Reversible — when
Mastra ships the loop fix on stable, register the tool on the agent and delete the branch.

| Element | How it's produced |
|---|---|
| Tool (`web_search`) | the provider-executed search tool call, rendered `Completed` |
| Sources + InlineCitation | the search result `source-url` parts (`sendSources:true`) |
| Web Preview | iframes the top REAL source URL (skips the `example.com` searchKnowledge stub) |
| Context | finish-step usage on `message.metadata` |

Verified live in the browser (agent-browser, haiku): a "latest Mastra news" query returned **19 real
sources**, a cited answer, and a `<WebPreview>` iframing `https://mastra.ai/blog/category/announcements`.
Note: many sites block iframe embedding (X-Frame-Options); the URL bar lets you try another.

**Overload resilience.** Anthropic returns HTTP 529 `overloaded_error` when capacity is momentarily
saturated (Sonnet more than Haiku — transient, not permanent). Each attempt sets `maxRetries: 4`
(exponential backoff), and the route wraps the turn in a `createUIMessageStream` model chain: the
chosen model first, then **Haiku as a fallback** if the primary stays overloaded. The opening frames
are buffered so a pre-content overload silently retries on the next model — the client never sees a
partial message. A non-overload error surfaces a clean error frame.

See the live, browsable status at **`/status`** (sourced from `packages/web/lib/wiring.ts`).
