/**
 * The AgentController fold: one event in, a new transcript out.
 *
 * Pure by design — no network, no React — which is what makes the whole
 * transport testable (tests/agent-controller/reduce.test.ts). Types live in
 * ./events; the normalisers and upserts used here live in ./reduce-helpers.
 */

import type {
  AgentControllerGoal,
  AgentControllerMessage,
  AgentControllerTaskItem,
  AgentControllerTranscript,
  AgentControllerUsage,
  SuspensionOption,
} from './events';
import {
  type AnyEvent,
  foldMemoryActivity,
  safeStringify,
  settledToolCallIds,
  upsertActiveTool,
  upsertMessage,
  upsertSubagent,
} from './reduce-helpers';

/**
 * Pure reducer: fold one AgentControllerEvent (or a transport sentinel) into the
 * transcript. Keeping this pure makes the whole transport testable without a
 * network or React.
 */
export function reduceAgentControllerEvent(
  state: AgentControllerTranscript,
  event: AnyEvent,
): AgentControllerTranscript {
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
      const messages = upsertMessage(state.messages, event.message as AgentControllerMessage);
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
      return { ...state, tasks: (event.tasks as AgentControllerTaskItem[]) ?? state.tasks };
    case 'usage_update':
      return { ...state, usage: (event.usage as AgentControllerUsage) ?? state.usage };
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
        status?: AgentControllerGoal['status'];
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
    // render the prompt; the run resumes when the user answers (POST /agent-controller/answer).
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
export function reduceAgentControllerEvents(
  state: AgentControllerTranscript,
  events: AnyEvent[],
): AgentControllerTranscript {
  return events.reduce(reduceAgentControllerEvent, state);
}
