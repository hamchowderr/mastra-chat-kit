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

/** What the SSE consumer folds events into and the view renders. */
export type HarnessTranscript = {
  threadId: string | null;
  messages: HarnessMessage[];
  tasks: HarnessTaskItem[];
  pendingApproval: PendingApproval | null;
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
  error: string | null;
  done: boolean;
};

export const emptyTranscript = (): HarnessTranscript => ({
  threadId: null,
  messages: [],
  tasks: [],
  pendingApproval: null,
  usage: null,
  queuedFollowUps: 0,
  terminal: { output: '', running: false },
  workspace: null,
  info: null,
  subagents: [],
  activeMode: null,
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
    case 'tool_end':
    case 'agent_end':
      return { ...state, pendingApproval: null, terminal: { ...state.terminal, running: false } };
    case 'message_start':
    case 'message_update':
    case 'message_end':
      return event.message
        ? { ...state, messages: upsertMessage(state.messages, event.message as HarnessMessage) }
        : state;
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
    case 'error':
      return {
        ...state,
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
 * Convert restored v6 UIMessages (text-only, from `/harness/threads/:id/messages`)
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
