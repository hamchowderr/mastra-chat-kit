/**
 * Client-side model of the Mastra AgentController SSE stream — the TYPE SURFACE.
 *
 * The server's POST /agent-controller/stream emits `AgentControllerEvent`s as SSE. The AgentController
 * surface is richer than AI SDK UIMessage parts (sessions, modes, approvals,
 * subagents, tasks), so instead of forcing it through `useChat` we reduce the
 * events into a small transcript model the AI Elements can render directly.
 * See docs/coverage.md for the full event → element mapping.
 *
 * Only the subset of events the UI consumes is typed here; unknown events pass
 * through the reducer untouched.
 *
 * This module is types plus two pure message utilities, and imports nothing —
 * which is why every skin can depend on it without pulling in the reducer. The
 * fold itself lives in ./reduce, and its internal helpers in ./reduce-helpers.
 */

export type AgentControllerContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; result: unknown; isError?: boolean }
  | { type: 'system_reminder'; message: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'file'; data: string; mediaType: string; filename?: string }
  // forward-compat: any other content kind is carried but not specially rendered
  | { type: string; [k: string]: unknown };

export type AgentControllerMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: AgentControllerContentPart[];
  createdAt?: string;
  stopReason?: 'complete' | 'tool_use' | 'aborted' | 'error';
  errorMessage?: string;
};

export type AgentControllerTaskItem = {
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

/** Token usage from the AgentController `usage_update` event (→ the Context element). */
export type AgentControllerUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

/**
 * Live shell state for the workbench Terminal tab. The controller streams the
 * sandbox's stdout/stderr as `shell_output` events (one per chunk, per running
 * command); we accumulate them into a single scrollback buffer. `running` drives
 * the Terminal's streaming caret and flips off when the run/tool settles.
 */
export type AgentControllerTerminal = { output: string; running: boolean };

/**
 * Workspace lifecycle, folded from `workspace_ready` / `workspace_status_changed`
 * / `workspace_error`. Drives the workbench status dot so the panel reflects
 * whether the agent's filesystem/sandbox/browser is initializing, live, or failed.
 */
export type AgentControllerWorkspace = { status: string; name?: string; error?: string };

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
export type AgentControllerGoal = {
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
export type AgentControllerMemory = {
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
 * One recurring schedule the controller agent has set up (native `mastra.schedules`).
 * Fetched from `/api/agent-controller/schedules` (not folded from events) since schedule
 * CRUD happens through the agent's start_schedule / stop_schedule tools, then the
 * panel refetches when a run settles. Read-only in the UI (agent-driven).
 */
export type AgentControllerSchedule = {
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
export type AgentControllerTranscript = {
  threadId: string | null;
  messages: AgentControllerMessage[];
  tasks: AgentControllerTaskItem[];
  pendingApproval: PendingApproval | null;
  /** A parked `ask_user` suspension awaiting the user's answer (→ the AskUserPrompt). */
  pendingSuspension: PendingSuspension | null;
  usage: AgentControllerUsage | null;
  queuedFollowUps: number;
  terminal: AgentControllerTerminal;
  /** Latest workspace lifecycle snapshot (null before the workspace reports in). */
  workspace: AgentControllerWorkspace | null;
  /** Latest `info` status message from the run (a transient status line). */
  info: string | null;
  /** Subagent invocations, keyed by the parent `subagent` tool-call id (→ Agent element). */
  subagents: SubagentRun[];
  /** Active controller mode id, reflected from `mode_changed` (→ the mode switcher). */
  activeMode: string | null;
  /** Current goal-run state, folded from `goal_evaluation` (→ the goal card). */
  goal: AgentControllerGoal | null;
  /** Observational-Memory state, folded from `om_*` (→ the workbench Memory panel). */
  memory: AgentControllerMemory | null;
  /** Tools whose input is still streaming (input-streaming <Tool>), suppressed once settled. */
  activeTools: ActiveTool[];
  error: string | null;
  done: boolean;
};

export const emptyTranscript = (): AgentControllerTranscript => ({
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
/**
 * Convert restored text-only UIMessages (AI SDK v7 parts shape, from `/agent-controller/threads/:id/messages`)
 * into transcript messages, so reopening a past conversation shows its history.
 * Only text is restored here; richer parts (tools, thinking) rehydrate on the live
 * stream when the conversation continues.
 */
export function uiMessagesToAgentController(
  messages: Array<{ id: string; role: string; parts?: Array<{ type: string; text?: string }> }>,
): AgentControllerMessage[] {
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
export function collectToolResults(
  messages: AgentControllerMessage[],
): Map<string, AgentControllerContentPart> {
  const byId = new Map<string, AgentControllerContentPart>();
  for (const m of messages) {
    for (const part of m.content) {
      if (part.type === 'tool_result' && typeof (part as { id?: string }).id === 'string') {
        byId.set((part as { id: string }).id, part);
      }
    }
  }
  return byId;
}
