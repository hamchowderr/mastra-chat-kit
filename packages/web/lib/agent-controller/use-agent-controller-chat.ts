'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AgentControllerGoal,
  type AgentControllerSchedule,
  type AgentControllerTranscript,
  approvalsState,
  emptyTranscript,
  uiMessagesToAgentController,
} from './events';
import { reduceAgentControllerEvent, reduceAgentControllerEvents } from './reduce';

export type AgentControllerStatus = 'ready' | 'streaming' | 'error';

type ControllerEvent = { type: string; [k: string]: unknown };

/**
 * Why the server refused a request: its own `{ error }` message when it sent one (a 400
 * says what was wrong with the message, a 413 that it was too large), otherwise the
 * status. A proxy's HTML error page is not shown.
 */
async function refusalReason(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  if (typeof body?.error === 'string' && body.error) return body.error;
  return `controller stream failed: ${res.status}`;
}

/**
 * Read a `data:`-framed SSE response of AgentControllerEvents to the end, handing
 * each parsed event to `onEvent`. Shared by a new message (/stream) and an ask_user
 * answer (/answer), which both stream a run back the same way.
 */
async function readEventStream(res: Response, onEvent: (event: ControllerEvent) => void) {
  if (!res.ok || !res.body) {
    throw new Error(await refusalReason(res));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunk = await reader.read();
  while (!chunk.done) {
    buffer += decoder.decode(chunk.value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      const json = dataLine?.slice(5).trim();
      if (!json) {
        continue;
      }
      let event: ControllerEvent;
      try {
        event = JSON.parse(json);
      } catch {
        continue; // A malformed frame is skipped, not fatal.
      }
      onEvent(event);
    }
    chunk = await reader.read();
  }
}

/** A tool call the agent finished: which tool, and whether it reported an error. */
export type AgentControllerToolEnd = { toolName: string; toolCallId: string; isError: boolean };

export type UseAgentControllerChatOptions = {
  /** The stream route. Default `/api/agent-controller/stream`. */
  endpoint?: string;
  /**
   * Called each time a tool call finishes, in a new turn or a resumed one. A host uses it
   * to react to what the agent changed, e.g. refresh its own page after a write.
   */
  onToolEnd?: (tool: AgentControllerToolEnd) => void;
};

/**
 * The browser's IANA time zone (e.g. `America/New_York`), sent with each turn so the
 * agent knows today's date where the user is. Undefined if the runtime can't say.
 */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Agent Controller transport, mirroring `useChat`'s shape (`{ messages,
 * sendMessage, status }`) but speaking the AgentController SSE protocol instead of the
 * AI SDK UIMessage stream. POSTs `{ text, threadId }` to the proxy, parses the
 * `data:`-framed SSE, and folds each AgentControllerEvent into a transcript.
 */
export function useAgentControllerChat(options: string | UseAgentControllerChatOptions = {}) {
  const { endpoint = '/api/agent-controller/stream', onToolEnd } =
    typeof options === 'string' ? { endpoint: options } : options;
  // The latest callback, so a host passing an inline function doesn't restart anything.
  const onToolEndRef = useRef(onToolEnd);
  onToolEndRef.current = onToolEnd;
  // tool_end carries only the call id; tool_start names the tool.
  const toolNames = useRef(new Map<string, string>());
  const [transcript, setTranscript] = useState<AgentControllerTranscript>(emptyTranscript);
  const [status, setStatus] = useState<AgentControllerStatus>('ready');
  // Recurring schedules the agent has set up (fetched, not folded from events —
  // schedule CRUD goes through the start/stop_schedule tools, so the panel refetches
  // when a run settles). Read-only in the UI.
  const [schedules, setSchedules] = useState<AgentControllerSchedule[]>([]);
  const threadRef = useRef<string | null>(null);
  // Bumps whenever a turn completes so the conversation sidebar refetches (a new
  // thread appears / an existing one re-sorts to the top).
  const [refreshSignal, setRefreshSignal] = useState(0);

  // Load any objective already set on the session's active thread (durable across a
  // reload within the server's lifetime). Live updates then arrive as `goal_evaluation`
  // over the SSE and fold onto this via the reducer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent-controller/goal', { cache: 'no-store' });
        const data = (await res.json()) as {
          objective?: {
            objective?: string;
            maxRuns?: number;
            runsUsed?: number;
            status?: AgentControllerGoal['status'];
          } | null;
        };
        if (cancelled || !data.objective?.objective) return;
        const o = data.objective;
        setTranscript((s) => ({
          ...s,
          goal: s.goal ?? {
            objective: o.objective as string,
            maxRuns: o.maxRuns,
            iteration: o.runsUsed,
            status: o.status,
          },
        }));
      } catch {
        // No goal surfaced if the server is unreachable — the card just stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hydrate the Memory panel with the facts OM has already distilled (resource-scoped,
  // so they apply across all of this user's chats). Called on mount and after switching/
  // resetting threads, so the panel shows learned memory on load instead of a bare empty
  // state — the live token windows still fill in from `om_status` on the next run.
  const refreshMemory = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-controller/om', { cache: 'no-store' });
      const data = (await res.json()) as { observations?: string | null };
      if (!data.observations) return;
      setTranscript((s) => ({
        ...s,
        memory: {
          status: s.memory?.status ?? null,
          activity: s.memory?.activity ?? [],
          observations: s.memory?.observations ?? data.observations ?? null,
        },
      }));
    } catch {
      // The panel just stays in its empty state if the server is unreachable.
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only hydration
  useEffect(() => {
    refreshMemory();
  }, []);

  // Load the agent's recurring schedules (the Schedules panel). Called on mount and
  // after each run settles, so a schedule the agent just created/paused shows up.
  const refreshSchedules = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-controller/schedules', { cache: 'no-store' });
      const data = (await res.json()) as { schedules?: AgentControllerSchedule[] };
      setSchedules(Array.isArray(data.schedules) ? data.schedules : []);
    } catch {
      // The panel just shows its empty state if the server is unreachable.
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only hydration
  useEffect(() => {
    refreshSchedules();
  }, []);

  /** Fold one event into the transcript, and tell the host when a tool call finishes. */
  const onEvent = useCallback((event: ControllerEvent) => {
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : '';
    if (event.type === 'tool_start' && id && typeof event.toolName === 'string') {
      toolNames.current.set(id, event.toolName);
    }
    if (event.type === 'tool_end' && id) {
      const toolName =
        (typeof event.toolName === 'string' && event.toolName) || toolNames.current.get(id) || '';
      toolNames.current.delete(id);
      onToolEndRef.current?.({ toolName, toolCallId: id, isError: event.isError === true });
    }
    setTranscript((s) => reduceAgentControllerEvent(s, event));
  }, []);

  /**
   * Send a message. Resolves once the server has answered: `true` when it accepted the
   * turn (which then streams into the transcript on its own), `false` when it refused it
   * or could not be reached, with the reason in `transcript.error`.
   */
  const sendMessage = useCallback(
    async (
      text: string,
      opts?: {
        model?: string;
        webSearch?: boolean;
        /** Controller mode for this turn ('plan' | 'chat'); the server switches if it differs. */
        mode?: string;
        files?: Array<{ url: string; mediaType: string; filename?: string }>;
      },
    ): Promise<boolean> => {
      if (!text.trim() && !opts?.files?.length) {
        return false;
      }
      // NOTE: no optimistic user message — the AgentController echoes the user turn as its
      // own `message_start`/`message_end` (role=user) at the start of the run. Adding
      // our own would render the user's message twice (different ids → both kept).
      setTranscript((s) => ({ ...s, error: null, done: false }));
      setStatus('streaming');

      const fail = (err: unknown) => {
        setTranscript((s) => ({
          ...s,
          error: err instanceof Error ? err.message : String(err),
        }));
        setStatus('error');
      };

      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // The composer's model / web-search / attachment selections ride along so
          // the controller honors them: the run switches model via `session.model.switch`,
          // web search flows through the request context, and files pass to sendMessage.
          body: JSON.stringify({
            text,
            threadId: threadRef.current,
            model: opts?.model,
            webSearch: opts?.webSearch,
            mode: opts?.mode,
            files: opts?.files,
            timeZone: browserTimeZone(),
          }),
        });
      } catch (err) {
        fail(err);
        return false;
      }
      // Refused (a bad message, too large, signed out …): say why, and tell the caller,
      // so the composer can keep what was typed and attached.
      if (!res.ok) {
        fail(new Error(await refusalReason(res)));
        return false;
      }

      // Accepted. The turn streams on; the caller does not wait for it to finish.
      void readEventStream(res, (event) => {
        if (event.type === '__thread__' && typeof event.threadId === 'string') {
          threadRef.current = event.threadId;
        }
        onEvent(event);
      }).then(() => {
        setStatus('ready');
        // A completed turn may have created a new thread (or bumped an existing
        // one) — nudge the sidebar to refetch.
        setRefreshSignal((n) => n + 1);
        // The turn may also have created or paused a schedule — refresh the panel.
        refreshSchedules();
      }, fail);
      return true;
    },
    [endpoint, refreshSchedules, onEvent],
  );

  /**
   * Resolve a parked tool-approval gate. The continuation events arrive on the
   * still-open SSE from the original sendMessage, so this just fires the decision.
   *
   * The gate is named by its `toolCallId` (the first pending approval's unless one is
   * given; core parks one gate per tool call), because the server answers only the gate
   * it names: an unnamed or stale answer resolves nothing. Resolves `true` when the server
   * took the decision and `false` when there was nothing to answer or it refused, with the
   * reason in `transcript.error`. Either way an answered gate's card goes: a taken one is
   * done, and one the server no longer holds (409) can't be reached by any answer. A 409
   * for a gate this client already answered (a double click) is not an error.
   */
  const answeredApprovals = useRef(new Set<string>());
  const pendingApprovalId = transcript.pendingApproval?.toolCallId;
  const approve = useCallback(
    async (
      decision: 'approve' | 'decline' | 'always_allow_category',
      toolCallId: string | undefined = pendingApprovalId,
    ): Promise<boolean> => {
      if (!toolCallId) return false;
      const dropCard = (error?: string) =>
        setTranscript((s) => ({
          ...s,
          ...approvalsState(s.pendingApprovals.filter((a) => a.toolCallId !== toolCallId)),
          ...(error !== undefined ? { error } : {}),
        }));
      let res: Response;
      try {
        res = await fetch('/api/agent-controller/approve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // The thread names which Session holds the gate (a work thread has its own).
          body: JSON.stringify({
            decision,
            toolCallId,
            ...(threadRef.current ? { threadId: threadRef.current } : {}),
          }),
        });
      } catch (err) {
        setTranscript((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
        return false;
      }
      if (res.ok) {
        answeredApprovals.current.add(toolCallId);
        dropCard();
        return true;
      }
      const reason = await refusalReason(res);
      if (res.status !== 409) {
        setTranscript((s) => ({ ...s, error: reason }));
      } else if (answeredApprovals.current.has(toolCallId)) {
        dropCard();
      } else {
        dropCard(reason);
      }
      return false;
    },
    [pendingApprovalId],
  );

  /**
   * Resume a parked suspension and stream the resumed run. A suspending tool ENDS the
   * run, so the original /stream response has already closed; the resumed run streams
   * back on this /answer response instead (mastra-chat-kit-ymk). The pending prompt is
   * cleared optimistically so it closes at once.
   */
  const resume = useCallback(
    async (body: Record<string, unknown>) => {
      setTranscript((s) => ({
        ...s,
        pendingSuspension: null,
        pendingPlan: null,
        error: null,
        done: false,
      }));
      setStatus('streaming');
      try {
        const res = await fetch('/api/agent-controller/answer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...body,
            ...(threadRef.current ? { threadId: threadRef.current } : {}),
            timeZone: browserTimeZone(),
          }),
        });
        await readEventStream(res, onEvent);
        setStatus('ready');
        setRefreshSignal((n) => n + 1);
        refreshSchedules();
      } catch (err) {
        setTranscript((s) => ({
          ...s,
          error: err instanceof Error ? err.message : String(err),
        }));
        setStatus('error');
      }
    },
    [refreshSchedules, onEvent],
  );

  /**
   * Answer a parked `ask_user` suspension. `answer` is a string (free-text / single
   * choice) or a string[] of chosen labels (multi-select).
   */
  const answerQuestion = useCallback(
    (answer: string | string[], toolCallId?: string) =>
      resume({ answer, ...(toolCallId ? { toolCallId } : {}) }),
    [resume],
  );

  /**
   * Decide a submitted plan (`submit_plan`). Approving resumes the agent on the plan —
   * and, in Plan mode, switches the session to Chat, which arrives as `mode_changed`.
   * Rejecting resumes it with the rejection (and optional feedback to revise by).
   */
  const respondToPlan = useCallback(
    (action: 'approved' | 'rejected', feedback?: string) =>
      resume({
        plan: { action, ...(feedback ? { feedback } : {}) },
        ...(transcript.pendingPlan ? { toolCallId: transcript.pendingPlan.toolCallId } : {}),
      }),
    [resume, transcript.pendingPlan],
  );

  /** Clear the workbench Terminal scrollback (the shell buffer is cumulative). */
  const clearTerminal = useCallback(() => {
    setTranscript((s) => ({ ...s, terminal: { ...s.terminal, output: '' } }));
  }, []);

  /**
   * Load a past conversation into the view. Fetches its messages (text-only
   * restore) and seeds a fresh transcript; follow-up turns continue this thread
   * (threadRef) so the server switches to it and memory carries context.
   *
   * A work thread (one the agent started with `start_thread`) can be running or parked
   * on an approval or a question while nobody watches it: what it waits on comes from
   * `/threads/:id/pending` and folds in as the live events would. Resolves to whether its
   * run is still going, so a skin can poll until it stops.
   */
  const openThread = useCallback(
    async (threadId: string): Promise<{ running: boolean }> => {
      const id = encodeURIComponent(threadId);
      let running = false;
      try {
        const [res, pending] = await Promise.all([
          fetch(`/api/agent-controller/threads/${id}/messages`, { cache: 'no-store' }),
          fetch(`/api/agent-controller/threads/${id}/pending`, { cache: 'no-store' }).then(
            async (r) =>
              r.ok ? ((await r.json()) as { running?: boolean; events?: ControllerEvent[] }) : {},
            () => ({}) as { running?: boolean; events?: ControllerEvent[] },
          ),
        ]);
        const data = (await res.json()) as {
          messages?: Array<{
            id: string;
            role: string;
            parts?: Array<{ type: string; text?: string }>;
          }>;
        };
        running = pending.running === true;
        threadRef.current = threadId;
        setStatus('ready');
        setTranscript(
          reduceAgentControllerEvents(
            {
              ...emptyTranscript(),
              threadId,
              messages: uiMessagesToAgentController(data.messages ?? []),
            },
            pending.events ?? [],
          ),
        );
      } catch {
        threadRef.current = threadId;
        setTranscript({ ...emptyTranscript(), threadId });
      }
      // Re-hydrate the learned OM facts (resource-scoped) onto the fresh transcript.
      refreshMemory();
      return { running };
    },
    [refreshMemory],
  );

  /** Clear the transcript and start a brand-new conversation (server mints a thread). */
  const reset = useCallback(() => {
    threadRef.current = null;
    setStatus('ready');
    setTranscript(emptyTranscript());
    // OM facts are resource-scoped, so they still apply in a brand-new chat.
    refreshMemory();
  }, [refreshMemory]);

  /** Clear the active thread's objective (the agent stops goal-driven looping). */
  const clearGoal = useCallback(async () => {
    setTranscript((s) => ({ ...s, goal: null }));
    try {
      await fetch('/api/agent-controller/goal', { method: 'DELETE' });
    } catch {
      // The optimistic clear stands even if the server call fails.
    }
  }, []);

  return {
    transcript,
    status,
    sendMessage,
    approve,
    /** Answer a parked `ask_user` prompt (string, or string[] for multi-select). */
    answerQuestion,
    /** The current `ask_user` prompt awaiting an answer (null when none). */
    pendingSuspension: transcript.pendingSuspension,
    /** Approve or reject the submitted plan awaiting a decision. */
    respondToPlan,
    /** The submitted plan awaiting Approve / Reject (null when none). */
    pendingPlan: transcript.pendingPlan,
    /** The controller mode the last `mode_changed` reported (null before any switch). */
    activeMode: transcript.activeMode,
    clearTerminal,
    openThread,
    reset,
    /** The current goal-run state (null when no objective is set). Set by the agent's own
     *  `setGoal` tool and updated by `goal_evaluation` events; the UI only reads it. */
    goal: transcript.goal,
    /** Clear the active objective (backs the goal card's dismiss control). */
    clearGoal,
    /** Observational-Memory state (token windows + activity), folded from `om_*`. */
    memory: transcript.memory,
    /** The agent's recurring schedules (read-only; refetched when a run settles). */
    schedules,
    /** Force a refetch of the schedules list (e.g. after the schedules tab opens). */
    refreshSchedules,
    /** The active conversation id (null before the first turn / after reset). */
    activeThreadId: transcript.threadId,
    /** Increments when a turn completes — drives the sidebar refetch. */
    refreshSignal,
  };
}

/** The shared controller transport, lifted to the shell so chat + workbench panel drive one session. */
export type UseAgentControllerChat = ReturnType<typeof useAgentControllerChat>;
