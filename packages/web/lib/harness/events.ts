/**
 * Client-side model of the Mastra Harness SSE stream.
 *
 * The server's POST /harness/stream emits `HarnessEvent`s as SSE. The Harness
 * surface is richer than AI SDK UIMessage parts (sessions, modes, approvals,
 * subagents, tasks), so instead of forcing it through `useChat` we reduce the
 * events into a small transcript model the AI Elements can render directly.
 * See docs/coverage.md for the full event → element mapping.
 *
 * Only the subset of events the UI consumes is typed here; unknown events pass
 * through the reducer untouched.
 */

export type HarnessContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; result: unknown; isError?: boolean }
  | { type: 'system_reminder'; message: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'file'; data: string; mediaType: string; filename?: string }
  // forward-compat: any other content kind is carried but not specially rendered
  | { type: string; [k: string]: unknown };

export type HarnessMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: HarnessContentPart[];
  createdAt?: string;
  stopReason?: 'complete' | 'tool_use' | 'aborted' | 'error';
  errorMessage?: string;
};

export type HarnessTaskItem = {
  id?: string;
  content?: string;
  title?: string;
  status?: string;
};

export type PendingApproval = { toolCallId: string; toolName: string; args: unknown };

/** One selectable choice on an `ask_user` prompt (label is the answer value). */
export type SuspensionOption = { label: string; description?: string };

/**
 * A parked tool suspension awaiting the user's answer — the agent-driven `ask_user`
 * flow. Folded from `tool_suspended`; its `suspendPayload` carries the question and,
 * optionally, choices. Free-text / single-select resume with a string; multi-select
 * resumes with the array of chosen labels. `null` when nothing is waiting.
 */
export type PendingSuspension = {
  toolCallId: string;
  toolName: string;
  question: string;
  options?: SuspensionOption[];
  selectionMode?: 'single_select' | 'multi_select';
};

/** Token usage from the Harness `usage_update` event (→ the Context element). */
export type HarnessUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

/**
 * Live shell state for the workbench Terminal tab. The harness streams the
 * sandbox's stdout/stderr as `shell_output` events (one per chunk, per running
 * command); we accumulate them into a single scrollback buffer. `running` drives
 * the Terminal's streaming caret and flips off when the run/tool settles.
 */
export type HarnessTerminal = { output: string; running: boolean };

/**
 * Workspace lifecycle, folded from `workspace_ready` / `workspace_status_changed`
 * / `workspace_error`. Drives the workbench status dot so the panel reflects
 * whether the agent's filesystem/sandbox/browser is initializing, live, or failed.
 */
export type HarnessWorkspace = { status: string; name?: string; error?: string };

/** One nested tool call a subagent made (subagent_tool_start → _tool_end). */
export type SubagentToolCall = {
  name: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
};

/**
 * A single subagent invocation, keyed by the parent's `subagent` tool-call id.
 * Folded from the six `subagent_*` events into a live view the `Agent` element
 * renders inline where the parent's `subagent` tool call appears.
 */
export type SubagentRun = {
  toolCallId: string;
  agentType: string;
  task?: string;
  modelId?: string;
  forked?: boolean;
  /** Streamed assistant text from the subagent (subagent_text_delta). */
  text: string;
  /** Nested tool calls the subagent made. */
  tools: SubagentToolCall[];
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
  status: 'running' | 'done';
};

/**
 * Goal-run state, folded from `goal_evaluation` events (and seeded optimistically by a
 * `setGoal` POST). Drives the goal card: the objective, iteration progress against the
 * run budget, whether the judge has passed it, its status, and the latest judge reason.
 * `null` when no objective is set on the active thread.
 */
export type HarnessGoal = {
  objective: string;
  /** Evaluations consumed so far (runsUsed after the latest evaluation). */
  iteration?: number;
  /** Max evaluations before the goal stops. */
  maxRuns?: number;
  /** Whether the judge has ruled the objective complete. */
  passed?: boolean;
  status?: 'active' | 'paused' | 'done';
  /** Judge feedback / stop reason. */
  reason?: string;
  /** Judge wants user input before continuing (loop paused, record still active). */
  waitingForUser?: boolean;
  /** The run budget (maxRuns) was reached without passing. */
  maxRunsReached?: boolean;
};

/**
 * Observational-Memory state, folded from the `om_*` events. `om_status` (the primary,
 * fires per run) carries the token windows: how many message tokens have accumulated
 * toward the observation threshold, and how many observation tokens toward reflection —
 * plus the observe/reflect buffer status. The lifecycle events (observation/reflection
 * start/end, activation) accumulate into a bounded activity log. Drives the Memory panel.
 */
export type HarnessMemory = {
  /** Latest `om_status` window snapshot — null before OM first reports in. */
  status: {
    messages: { tokens: number; threshold: number };
    observations: { tokens: number; threshold: number };
    observationBuffer: { status: string; chunks: number };
    reflectionBuffer: { status: string };
  } | null;
  /** Rolling log of OM lifecycle activity (newest last), bounded. */
  activity: { kind: 'observe' | 'reflect' | 'activate'; detail: string; failed?: boolean }[];
  /** The most recently distilled observations text, when the Observer/Reflector surfaces one. */
  observations: string | null;
};

/**
 * One recurring schedule the harness agent has set up (native `mastra.schedules`).
 * Fetched from `/api/harness/schedules` (not folded from events) since schedule
 * CRUD happens through the agent's start_schedule / stop_schedule tools, then the
 * panel refetches when a run settles. Read-only in the UI (agent-driven).
 */
export type HarnessSchedule = {
  id: string;
  cron: string;
  prompt: string;
  status: 'active' | 'paused';
  /** Epoch ms of the next planned fire (0 when paused/unknown). */
  nextFireAt: number;
  /** Epoch ms of the last fire, or null if it hasn't fired yet. */
  lastFireAt?: number | null;
  name?: string;
};

/**
 * A tool call whose input is still streaming — folded from the granular `tool_input_*`
 * / `tool_start` events that fire BEFORE the settled `message_update` tool-invocation
 * part arrives. Rendered as an input-streaming `<Tool>` for the window between the
 * first arg delta and the settled message part, then SUPPRESSED (removed) the moment a
 * message `tool_call` part with the same `toolCallId` lands — so it never double-renders
 * against the settled Tool.
 *
 * Real event order (captured live, 698.25): `tool_input_start` → `tool_input_delta`×N →
 * `tool_input_end` → `tool_start` → `message_update`[tool-invocation] → (gate). On a fast
 * model the settled part arrives near-instantly, so this state is mostly visible when the
 * model streams args slowly or the tool takes large inputs.
 */
export type ActiveTool = {
  toolCallId: string;
  name: string;
  /** Accumulated raw args text (JSON), streamed in via `tool_input_delta.argsTextDelta`. */
  argsText: string;
  /** `input-streaming` while deltas arrive; `input-available` once `tool_input_end`/`tool_start` lands. */
  state: 'input-streaming' | 'input-available';
};

/** What the SSE consumer folds events into and the view renders. */
export type HarnessTranscript = {
  threadId: string | null;
  messages: HarnessMessage[];
  tasks: HarnessTaskItem[];
  pendingApproval: PendingApproval | null;
  /** A parked `ask_user` suspension awaiting the user's answer (→ the AskUserPrompt). */
  pendingSuspension: PendingSuspension | null;
  usage: HarnessUsage | null;
  queuedFollowUps: number;
  terminal: HarnessTerminal;
  /** Latest workspace lifecycle snapshot (null before the workspace reports in). */
  workspace: HarnessWorkspace | null;
  /** Latest `info` status message from the run (a transient status line). */
  info: string | null;
  /** Subagent invocations, keyed by the parent `subagent` tool-call id (→ Agent element). */
  subagents: SubagentRun[];
  /** Active controller mode id, reflected from `mode_changed` (→ the mode switcher). */
  activeMode: string | null;
  /** Current goal-run state, folded from `goal_evaluation` (→ the goal card). */
  goal: HarnessGoal | null;
  /** Observational-Memory state, folded from `om_*` (→ the workbench Memory panel). */
  memory: HarnessMemory | null;
  /** Tools whose input is still streaming (input-streaming <Tool>), suppressed once settled. */
  activeTools: ActiveTool[];
  error: string | null;
  done: boolean;
};

export const emptyTranscript = (): HarnessTranscript => ({
  threadId: null,
  messages: [],
  tasks: [],
  pendingApproval: null,
  pendingSuspension: null,
  usage: null,
  queuedFollowUps: 0,
  terminal: { output: '', running: false },
  workspace: null,
  info: null,
  subagents: [],
  activeMode: null,
  goal: null,
  memory: null,
  activeTools: [],
  error: null,
  done: false,
});

// biome-ignore lint/suspicious/noExplicitAny: HarnessEvent is a wide discriminated union; we switch on .type
type AnyEvent = { type: string; [k: string]: any };

/**
 * Map one Mastra "format 2" UI part (core ≥1.52) to one or more transcript parts.
 * Assistant text arrives as `{type:'text',text}`; the user's own turn arrives as
 * a `data-user-message` part with the text on `data.contents`; reasoning and tool
 * parts map to thinking / tool_call / tool_result.
 *
 * Tool parts come in TWO shapes and we handle both:
 *  - **v4-nested** `{type:'tool-invocation', toolInvocation:{state,toolCallId,toolName,args,result}}`
 *    — the shape Mastra core ≥1.52 actually emits. A `state:'result'` invocation
 *    expands to a `tool_call` + a paired `tool_result` (so the renderer, which
 *    pairs results to calls by id, shows args AND output).
 *  - **v5-flat** `tool-<name>` / `dynamic-tool` — kept for forward-compat.
 * Returns a single part, an array (call+result), or null.
 */
// biome-ignore lint/suspicious/noExplicitAny: format-2 UI parts are a heterogeneous union
function mapFormat2Part(p: any): HarnessContentPart | HarnessContentPart[] | null {
  if (!p || typeof p !== 'object') return null;
  const t = p.type as string | undefined;
  if (t === 'text') {
    return typeof p.text === 'string' && p.text ? { type: 'text', text: p.text } : null;
  }
  if (t === 'data-user-message' && typeof p.data?.contents === 'string') {
    return { type: 'text', text: p.data.contents };
  }
  if (t === 'reasoning' && typeof p.text === 'string') {
    return { type: 'thinking', thinking: p.text };
  }
  // v4-nested tool part — check BEFORE the flat `tool-` branch (its type also
  // starts with `tool-`, but its data lives under `toolInvocation`, not on `p`).
  if (t === 'tool-invocation' && p.toolInvocation && typeof p.toolInvocation === 'object') {
    const ti = p.toolInvocation;
    const id = ti.toolCallId ?? '';
    const name = ti.toolName ?? 'tool';
    const call: HarnessContentPart = { type: 'tool_call', id, name, args: ti.args };
    if (ti.state === 'result') {
      return [call, { type: 'tool_result', id, name, result: ti.result, isError: !!ti.isError }];
    }
    return call;
  }
  if (typeof t === 'string' && (t.startsWith('tool-') || t === 'dynamic-tool')) {
    const name = t === 'dynamic-tool' ? (p.toolName ?? 'tool') : t.replace('tool-', '');
    if (p.output !== undefined || p.state === 'output-available' || p.state === 'output-error') {
      return {
        type: 'tool_result',
        id: p.toolCallId ?? '',
        name,
        result: p.output,
        isError: p.state === 'output-error',
      };
    }
    return { type: 'tool_call', id: p.toolCallId ?? '', name, args: p.input };
  }
  return null;
}

/**
 * Coerce a message's `content` into `HarnessContentPart[]`. Handles: a plain
 * array (older format), a bare string (some providers), and — crucially — the
 * Mastra core ≥1.52 "format 2" object `{ format, parts, metadata }` whose `parts`
 * are AI-SDK UI parts. Everything else (null shells before parts stream) → [].
 */
function normalizeContent(content: unknown): HarnessContentPart[] {
  if (Array.isArray(content)) return content as HarnessContentPart[];
  if (typeof content === 'string' && content.length > 0) return [{ type: 'text', text: content }];
  const parts = (content as { parts?: unknown } | null)?.parts;
  if (Array.isArray(parts)) {
    // flatMap: a v4-nested tool part expands to a tool_call + tool_result pair.
    return parts.flatMap((p) => {
      const mapped = mapFormat2Part(p);
      if (mapped === null) return [];
      return Array.isArray(mapped) ? mapped : [mapped];
    });
  }
  return [];
}

/**
 * A `role: "signal"` message that carries the user's turn (a `data-user-message`
 * part, or `metadata.signal.type === "user"`) IS the user speaking — surface it
 * as `user` so the renderer shows it (it only renders user/assistant). Any other
 * signal becomes `system` (rendered nowhere).
 */
function effectiveRole(msg: HarnessMessage): 'user' | 'assistant' | 'system' {
  const role = msg.role as string;
  if (role === 'user' || role === 'assistant' || role === 'system') return role;
  const c = msg.content as { parts?: unknown[]; metadata?: { signal?: { type?: string } } } | null;
  const isUser =
    c?.metadata?.signal?.type === 'user' ||
    (Array.isArray(c?.parts) &&
      c.parts.some((p) => (p as { type?: string })?.type === 'data-user-message'));
  return isUser ? 'user' : 'system';
}

/** Upsert an active (still-streaming) tool by toolCallId. */
function upsertActiveTool(list: ActiveTool[], t: ActiveTool): ActiveTool[] {
  const idx = list.findIndex((x) => x.toolCallId === t.toolCallId);
  if (idx === -1) {
    return [...list, t];
  }
  const next = list.slice();
  next[idx] = t;
  return next;
}

/** All toolCallIds that have a SETTLED `tool_call` part somewhere in the messages. */
function settledToolCallIds(messages: HarnessMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    for (const p of m.content) {
      if (p.type === 'tool_call') {
        const id = (p as { id?: string }).id;
        if (typeof id === 'string' && id) {
          ids.add(id);
        }
      }
    }
  }
  return ids;
}

/** Best-effort JSON string of tool args (for the input-available fallback). */
function safeStringify(v: unknown): string {
  if (typeof v === 'string') {
    return v;
  }
  try {
    return JSON.stringify(v ?? {});
  } catch {
    return '';
  }
}

function upsertMessage(messages: HarnessMessage[], msg: HarnessMessage): HarnessMessage[] {
  const m: HarnessMessage = {
    ...msg,
    role: effectiveRole(msg),
    content: Array.isArray(msg.content) ? msg.content : normalizeContent(msg.content),
  };
  const idx = messages.findIndex((x) => x.id === m.id);
  if (idx === -1) {
    return [...messages, m];
  }
  const next = messages.slice();
  next[idx] = m;
  return next;
}

/**
 * Upsert a subagent run by `toolCallId`, applying `patch` (a partial merge, or a
 * function of the current run). Creates a stub `running` run if none exists yet,
 * so out-of-order events (e.g. a delta before start) never drop.
 */
function upsertSubagent(
  runs: SubagentRun[],
  toolCallId: string,
  patch: Partial<SubagentRun> | ((r: SubagentRun) => SubagentRun),
): SubagentRun[] {
  const idx = runs.findIndex((r) => r.toolCallId === toolCallId);
  const base: SubagentRun =
    idx === -1
      ? { toolCallId, agentType: 'subagent', text: '', tools: [], status: 'running' }
      : runs[idx];
  const nextRun = typeof patch === 'function' ? patch(base) : { ...base, ...patch };
  const next = runs.slice();
  if (idx === -1) next.push(nextRun);
  else next[idx] = nextRun;
  return next;
}

/**
 * Append one OM lifecycle entry to the memory activity log (bounded to the last 30,
 * newest last) and optionally update the distilled observations text. Seeds an empty
 * memory shell if none exists yet (an activity event can arrive before the first
 * `om_status`), so nothing drops.
 */
function foldMemoryActivity(
  state: HarnessTranscript,
  entry: HarnessMemory['activity'][number],
  observations?: string,
): HarnessTranscript {
  const base: HarnessMemory = state.memory ?? { status: null, activity: [], observations: null };
  return {
    ...state,
    memory: {
      ...base,
      activity: [...base.activity, entry].slice(-30),
      observations: observations ?? base.observations,
    },
  };
}

/**
 * Pure reducer: fold one HarnessEvent (or a transport sentinel) into the
 * transcript. Keeping this pure makes the whole transport testable without a
 * network or React.
 */
export function reduceHarnessEvent(state: HarnessTranscript, event: AnyEvent): HarnessTranscript {
  switch (event.type) {
    case '__thread__':
      return { ...state, threadId: event.threadId ?? state.threadId };
    case '__done__':
      return {
        ...state,
        done: true,
        pendingApproval: null,
        pendingSuspension: null,
        // The run ended — any tool still marked "streaming input" is stale.
        activeTools: [],
        terminal: { ...state.terminal, running: false },
      };
    // The sandbox streams command stdout/stderr as it runs — accumulate it into
    // the Terminal scrollback and mark a command in flight.
    case 'shell_output':
      return {
        ...state,
        terminal: { output: state.terminal.output + String(event.output ?? ''), running: true },
      };
    // Once the gate resolves (approved → tool runs, or declined → run ends), the
    // approval is no longer pending. Clear it on any of these resolution events.
    // These also settle a running command, so drop the Terminal's streaming caret.
    // A `tool_end` also RESOLVES a matching `ask_user` suspension — the suspended
    // tool re-ran with the answer and returned — so clear pendingSuspension only when
    // this end is that tool (agent_end carries no toolCallId, so a live prompt stays).
    case 'tool_end':
    case 'agent_end':
      return {
        ...state,
        pendingApproval: null,
        pendingSuspension:
          event.toolCallId && state.pendingSuspension?.toolCallId === event.toolCallId
            ? null
            : state.pendingSuspension,
        // Drop the finished tool's live entry (agent_end has no id → clear all).
        activeTools: event.toolCallId
          ? state.activeTools.filter((t) => t.toolCallId !== event.toolCallId)
          : [],
        terminal: { ...state.terminal, running: false },
      };
    // A settled message part is the canonical Tool render. After folding it in, drop any
    // live (input-streaming) entry whose tool_call now has a message part — so the live
    // <Tool> is replaced by the settled one, never rendered alongside it (no double-render).
    case 'message_start':
    case 'message_update':
    case 'message_end': {
      if (!event.message) {
        return state;
      }
      const messages = upsertMessage(state.messages, event.message as HarnessMessage);
      const settled = settledToolCallIds(messages);
      const activeTools = settled.size
        ? state.activeTools.filter((t) => !settled.has(t.toolCallId))
        : state.activeTools;
      return { ...state, messages, activeTools };
    }
    // ── Live tool-input streaming (698.25) ──────────────────────────────────────
    // The granular input events fold into `activeTools` so a tool renders in its
    // input-streaming state while args stream, BEFORE the settled message part lands
    // (which then suppresses the live entry — see the message case above).
    case 'tool_input_start':
      return {
        ...state,
        activeTools: upsertActiveTool(state.activeTools, {
          toolCallId: String(event.toolCallId ?? ''),
          name: String(event.toolName ?? ''),
          argsText: '',
          state: 'input-streaming',
        }),
      };
    case 'tool_input_delta': {
      const toolCallId = String(event.toolCallId ?? '');
      const existing = state.activeTools.find((t) => t.toolCallId === toolCallId);
      const delta =
        typeof event.argsTextDelta === 'string'
          ? event.argsTextDelta
          : String(event.argsTextDelta ?? '');
      return {
        ...state,
        activeTools: upsertActiveTool(state.activeTools, {
          toolCallId,
          name: existing?.name ?? String(event.toolName ?? ''),
          argsText: (existing?.argsText ?? '') + delta,
          state: 'input-streaming',
        }),
      };
    }
    case 'tool_input_end': {
      const existing = state.activeTools.find((t) => t.toolCallId === event.toolCallId);
      if (!existing) {
        return state;
      }
      return {
        ...state,
        activeTools: upsertActiveTool(state.activeTools, { ...existing, state: 'input-available' }),
      };
    }
    // The tool call is fully formed (args complete). Ensure a live entry exists with the
    // final args — covers the case where input deltas were coalesced/missed.
    case 'tool_start': {
      const toolCallId = String(event.toolCallId ?? '');
      const existing = state.activeTools.find((t) => t.toolCallId === toolCallId);
      // If the settled message part already landed, don't resurrect a live entry.
      if (settledToolCallIds(state.messages).has(toolCallId)) {
        return state;
      }
      return {
        ...state,
        activeTools: upsertActiveTool(state.activeTools, {
          toolCallId,
          name: String(event.toolName ?? existing?.name ?? ''),
          argsText: existing?.argsText || safeStringify(event.args),
          state: 'input-available',
        }),
      };
    }
    case 'task_updated':
      return { ...state, tasks: (event.tasks as HarnessTaskItem[]) ?? state.tasks };
    case 'usage_update':
      return { ...state, usage: (event.usage as HarnessUsage) ?? state.usage };
    case 'follow_up_queued':
      return { ...state, queuedFollowUps: Number(event.count ?? 0) };
    // Workspace lifecycle → the workbench status dot. `workspace_ready` names the
    // live workspace; `workspace_status_changed` reports a lifecycle transition
    // (pending…destroyed); `workspace_error` surfaces a failure.
    case 'workspace_ready':
      return {
        ...state,
        workspace: {
          status: 'ready',
          ...(typeof event.workspaceName === 'string' ? { name: event.workspaceName } : {}),
        },
      };
    case 'workspace_status_changed':
      return {
        ...state,
        workspace: {
          status: String(event.status ?? 'unknown'),
          ...(event.error ? { error: String(event.error) } : {}),
        },
      };
    case 'workspace_error':
      return {
        ...state,
        workspace: {
          status: 'error',
          error: typeof event.error === 'string' ? event.error : JSON.stringify(event.error),
        },
      };
    // Informational status line (transient — latest wins).
    case 'info':
      return {
        ...state,
        info: typeof event.message === 'string' ? event.message : String(event.message ?? ''),
      };
    // Active mode changed (manual switch or a plan→build transition). Reflect it so
    // the mode switcher highlights the current mode mid-run.
    case 'mode_changed':
      return typeof event.modeId === 'string' ? { ...state, activeMode: event.modeId } : state;
    // The native goal loop judged the objective after a turn. Fold the payload into the
    // goal card — objective, iteration vs budget, pass/status, and the judge's reason —
    // merging onto any goal seeded optimistically by setGoal.
    case 'goal_evaluation': {
      const p = (event.payload ?? {}) as {
        objective?: string;
        iteration?: number;
        maxRuns?: number;
        passed?: boolean;
        status?: HarnessGoal['status'];
        reason?: string;
        waitingForUser?: boolean;
        maxRunsReached?: boolean;
      };
      return {
        ...state,
        goal: {
          objective:
            typeof p.objective === 'string' && p.objective
              ? p.objective
              : (state.goal?.objective ?? ''),
          iteration: p.iteration,
          maxRuns: p.maxRuns ?? state.goal?.maxRuns,
          passed: p.passed,
          status: p.status,
          reason: p.reason,
          waitingForUser: p.waitingForUser,
          maxRunsReached: p.maxRunsReached,
        },
      };
    }
    // Observational Memory (698.35) → the workbench Memory panel. `om_status` (per run)
    // carries the token windows + buffer state; the lifecycle events accumulate into a
    // bounded activity log. `observations` holds the latest distilled facts when surfaced.
    case 'om_status': {
      const w = (event.windows ?? {}) as {
        active?: {
          messages?: { tokens?: number; threshold?: number };
          observations?: { tokens?: number; threshold?: number };
        };
        buffered?: {
          observations?: { status?: string; chunks?: number };
          reflection?: { status?: string };
        };
      };
      return {
        ...state,
        memory: {
          status: {
            messages: {
              tokens: Number(w.active?.messages?.tokens ?? 0),
              threshold: Number(w.active?.messages?.threshold ?? 0),
            },
            observations: {
              tokens: Number(w.active?.observations?.tokens ?? 0),
              threshold: Number(w.active?.observations?.threshold ?? 0),
            },
            observationBuffer: {
              status: String(w.buffered?.observations?.status ?? 'idle'),
              chunks: Number(w.buffered?.observations?.chunks ?? 0),
            },
            reflectionBuffer: { status: String(w.buffered?.reflection?.status ?? 'idle') },
          },
          activity: state.memory?.activity ?? [],
          observations: state.memory?.observations ?? null,
        },
      };
    }
    case 'om_observation_start':
      return foldMemoryActivity(state, {
        kind: 'observe',
        detail: `Observing ${Number(event.tokensToObserve ?? 0)} tokens…`,
      });
    case 'om_observation_end':
      return foldMemoryActivity(
        state,
        { kind: 'observe', detail: `Observed in ${Number(event.durationMs ?? 0)}ms` },
        typeof event.observations === 'string' ? event.observations : undefined,
      );
    case 'om_observation_failed':
      return foldMemoryActivity(state, {
        kind: 'observe',
        detail: `Observation failed: ${String(event.error ?? 'unknown')}`,
        failed: true,
      });
    case 'om_reflection_start':
      return foldMemoryActivity(state, {
        kind: 'reflect',
        detail: `Reflecting on ${Number(event.tokensToReflect ?? 0)} tokens…`,
      });
    case 'om_reflection_end':
      return foldMemoryActivity(
        state,
        {
          kind: 'reflect',
          detail: `Compressed to ${Number(event.compressedTokens ?? 0)} tokens in ${Number(event.durationMs ?? 0)}ms`,
        },
        typeof event.observations === 'string' ? event.observations : undefined,
      );
    case 'om_reflection_failed':
      return foldMemoryActivity(state, {
        kind: 'reflect',
        detail: `Reflection failed: ${String(event.error ?? 'unknown')}`,
        failed: true,
      });
    case 'om_activation':
      return foldMemoryActivity(state, {
        kind: 'activate',
        detail: `Activated ${Number(event.chunksActivated ?? 0)} chunk(s) (${Number(event.tokensActivated ?? 0)} tokens)`,
      });
    // Subagents (6 events, keyed by the parent `subagent` tool-call id) → the Agent
    // element renders inline where the parent's `subagent` tool call appears.
    case 'subagent_start':
      return {
        ...state,
        subagents: upsertSubagent(state.subagents, event.toolCallId, {
          agentType: String(event.agentType ?? 'subagent'),
          task: typeof event.task === 'string' ? event.task : undefined,
          modelId: typeof event.modelId === 'string' ? event.modelId : undefined,
          forked: event.forked === true,
          status: 'running',
        }),
      };
    case 'subagent_text_delta':
      return {
        ...state,
        subagents: upsertSubagent(state.subagents, event.toolCallId, (r) => ({
          ...r,
          text: r.text + String(event.textDelta ?? ''),
        })),
      };
    case 'subagent_tool_start':
      return {
        ...state,
        subagents: upsertSubagent(state.subagents, event.toolCallId, (r) => ({
          ...r,
          tools: [
            ...r.tools,
            { name: String(event.subToolName ?? 'tool'), args: event.subToolArgs },
          ],
        })),
      };
    case 'subagent_tool_end':
      return {
        ...state,
        subagents: upsertSubagent(state.subagents, event.toolCallId, (r) => {
          // Settle the last unresolved call with this name (falls back to the last one).
          const name = String(event.subToolName ?? 'tool');
          const tools = r.tools.slice();
          let i = tools.map((t) => t.name).lastIndexOf(name);
          if (i === -1) i = tools.length - 1;
          if (i >= 0) {
            tools[i] = {
              ...tools[i],
              result: event.subToolResult,
              isError: event.isError === true,
            };
          }
          return { ...r, tools };
        }),
      };
    case 'subagent_end':
      return {
        ...state,
        subagents: upsertSubagent(state.subagents, event.toolCallId, {
          result: event.result,
          isError: event.isError === true,
          durationMs: typeof event.durationMs === 'number' ? event.durationMs : undefined,
          status: 'done',
        }),
      };
    case 'subagent_model_changed':
      // The subagent's backing model changed — reflect it on running runs of that type.
      return typeof event.agentType === 'string'
        ? {
            ...state,
            subagents: state.subagents.map((r) =>
              r.agentType === event.agentType && r.status === 'running'
                ? { ...r, modelId: String(event.modelId ?? r.modelId) }
                : r,
            ),
          }
        : state;
    case 'tool_approval_required':
      return {
        ...state,
        pendingApproval: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        },
      };
    // The agent called `ask_user` (or another suspending builtin) and the run parked
    // awaiting an answer. Lift the question out of the suspend payload so the UI can
    // render the prompt; the run resumes when the user answers (POST /harness/answer).
    case 'tool_suspended': {
      const p = (event.suspendPayload ?? {}) as {
        question?: string;
        options?: SuspensionOption[];
        selectionMode?: 'single_select' | 'multi_select';
      };
      // Only surface a prompt we can render — an ask_user-shaped payload with a
      // question. Other suspending tools without one pass through untouched.
      if (typeof p.question !== 'string' || !p.question) {
        return state;
      }
      return {
        ...state,
        pendingSuspension: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          question: p.question,
          ...(Array.isArray(p.options) ? { options: p.options } : {}),
          ...(p.selectionMode ? { selectionMode: p.selectionMode } : {}),
        },
      };
    }
    // The suspension was cancelled server-side (e.g. the run failed before it could be
    // resumed) — drop the matching prompt so the user isn't left answering a dead one.
    case 'tool_suspension_cancelled':
      return state.pendingSuspension?.toolCallId === event.toolCallId
        ? { ...state, pendingSuspension: null }
        : state;
    case 'error':
      return {
        ...state,
        activeTools: [],
        error: typeof event.error === 'string' ? event.error : JSON.stringify(event.error),
      };
    default:
      return state;
  }
}

/** Reduce a batch of events (e.g. a full SSE flush) onto a starting state. */
export function reduceHarnessEvents(
  state: HarnessTranscript,
  events: AnyEvent[],
): HarnessTranscript {
  return events.reduce(reduceHarnessEvent, state);
}

/**
 * Convert restored text-only UIMessages (AI SDK v7 parts shape, from `/harness/threads/:id/messages`)
 * into transcript messages, so reopening a past conversation shows its history.
 * Only text is restored here; richer parts (tools, thinking) rehydrate on the live
 * stream when the conversation continues — same trade-off the Single Agent path makes.
 */
export function uiMessagesToHarness(
  messages: Array<{ id: string; role: string; parts?: Array<{ type: string; text?: string }> }>,
): HarnessMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
    content: (m.parts ?? [])
      .filter(
        (p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string',
      )
      .map((p) => ({ type: 'text', text: p.text })),
  }));
}

/** Collect tool_result content across all messages, keyed by tool-call id. */
export function collectToolResults(messages: HarnessMessage[]): Map<string, HarnessContentPart> {
  const byId = new Map<string, HarnessContentPart>();
  for (const m of messages) {
    for (const part of m.content) {
      if (part.type === 'tool_result' && typeof (part as { id?: string }).id === 'string') {
        byId.set((part as { id: string }).id, part);
      }
    }
  }
  return byId;
}
