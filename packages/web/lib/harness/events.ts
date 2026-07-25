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

/** What the SSE consumer folds events into and the view renders. */
export type HarnessTranscript = {
  threadId: string | null;
  messages: HarnessMessage[];
  tasks: HarnessTaskItem[];
  pendingApproval: PendingApproval | null;
  usage: HarnessUsage | null;
  queuedFollowUps: number;
  terminal: HarnessTerminal;
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
  error: null,
  done: false,
});

// biome-ignore lint/suspicious/noExplicitAny: HarnessEvent is a wide discriminated union; we switch on .type
type AnyEvent = { type: string; [k: string]: any };

/**
 * Providers other than Anthropic (notably OpenAI) can hand us a message whose
 * `content` is `null` or a bare string — e.g. an assistant turn that's purely a
 * tool call, or a message shell that arrives before its parts stream in. The
 * transcript model and every consumer (`collectToolResults`, the renderer) assume
 * an array of parts, so coerce it here at the single point messages enter.
 */
function normalizeContent(content: unknown): HarnessContentPart[] {
  if (Array.isArray(content)) return content as HarnessContentPart[];
  if (typeof content === 'string' && content.length > 0) return [{ type: 'text', text: content }];
  return [];
}

function upsertMessage(messages: HarnessMessage[], msg: HarnessMessage): HarnessMessage[] {
  const m = Array.isArray(msg.content) ? msg : { ...msg, content: normalizeContent(msg.content) };
  const idx = messages.findIndex((x) => x.id === m.id);
  if (idx === -1) {
    return [...messages, m];
  }
  const next = messages.slice();
  next[idx] = m;
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
