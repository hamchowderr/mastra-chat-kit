/**
 * Internals of the AgentController fold — see ./reduce.
 *
 * Split out of ./events so no single file in this engine runs past ~500 lines.
 * Nothing here is part of the engine's public surface: these are the normalisers
 * and upserts `reduceAgentControllerEvent` applies while folding one event.
 *
 * Only what ./reduce actually calls is exported. `mapFormat2Part`,
 * `normalizeContent` and `effectiveRole` stay module-private because they are
 * reached through `upsertMessage` rather than directly — exporting them would
 * widen the engine's surface for no caller.
 */

import type {
  ActiveTool,
  AgentControllerContentPart,
  AgentControllerMemory,
  AgentControllerMessage,
  AgentControllerTranscript,
  SubagentRun,
} from './events';

// biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent is a wide discriminated union; we switch on .type
export type AnyEvent = { type: string; [k: string]: any };

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
function mapFormat2Part(p: any): AgentControllerContentPart | AgentControllerContentPart[] | null {
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
    const call: AgentControllerContentPart = { type: 'tool_call', id, name, args: ti.args };
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
 * Coerce a message's `content` into `AgentControllerContentPart[]`. Handles: a plain
 * array (older format), a bare string (some providers), and — crucially — the
 * Mastra core ≥1.52 "format 2" object `{ format, parts, metadata }` whose `parts`
 * are AI-SDK UI parts. Everything else (null shells before parts stream) → [].
 */
function normalizeContent(content: unknown): AgentControllerContentPart[] {
  if (Array.isArray(content)) return content as AgentControllerContentPart[];
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
function effectiveRole(msg: AgentControllerMessage): 'user' | 'assistant' | 'system' {
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
export function upsertActiveTool(list: ActiveTool[], t: ActiveTool): ActiveTool[] {
  const idx = list.findIndex((x) => x.toolCallId === t.toolCallId);
  if (idx === -1) {
    return [...list, t];
  }
  const next = list.slice();
  next[idx] = t;
  return next;
}

/** All toolCallIds that have a SETTLED `tool_call` part somewhere in the messages. */
export function settledToolCallIds(messages: AgentControllerMessage[]): Set<string> {
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
export function safeStringify(v: unknown): string {
  if (typeof v === 'string') {
    return v;
  }
  try {
    return JSON.stringify(v ?? {});
  } catch {
    return '';
  }
}

export function upsertMessage(
  messages: AgentControllerMessage[],
  msg: AgentControllerMessage,
): AgentControllerMessage[] {
  const m: AgentControllerMessage = {
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
export function upsertSubagent(
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
export function foldMemoryActivity(
  state: AgentControllerTranscript,
  entry: AgentControllerMemory['activity'][number],
  observations?: string,
): AgentControllerTranscript {
  const base: AgentControllerMemory = state.memory ?? {
    status: null,
    activity: [],
    observations: null,
  };
  return {
    ...state,
    memory: {
      ...base,
      activity: [...base.activity, entry].slice(-30),
      observations: observations ?? base.observations,
    },
  };
}
