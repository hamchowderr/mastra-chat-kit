'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AgentControllerGoal,
  type AgentControllerSchedule,
  type AgentControllerTranscript,
  emptyTranscript,
  reduceAgentControllerEvent,
  uiMessagesToAgentController,
} from './events';

export type AgentControllerStatus = 'ready' | 'streaming' | 'error';

/**
 * The Agent Controller transport, mirroring `useChat`'s shape (`{ messages,
 * sendMessage, status }`) but speaking the AgentController SSE protocol instead of the
 * AI SDK UIMessage stream. POSTs `{ text, threadId }` to the proxy, parses the
 * `data:`-framed SSE, and folds each AgentControllerEvent into a transcript.
 */
export function useAgentControllerChat(endpoint = '/api/agent-controller/stream') {
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

  const sendMessage = useCallback(
    async (
      text: string,
      opts?: {
        model?: string;
        webSearch?: boolean;
        files?: Array<{ url: string; mediaType: string; filename?: string }>;
      },
    ) => {
      if (!text.trim() && !opts?.files?.length) {
        return;
      }
      // NOTE: no optimistic user message — the AgentController echoes the user turn as its
      // own `message_start`/`message_end` (role=user) at the start of the run. Adding
      // our own would render the user's message twice (different ids → both kept).
      setTranscript((s) => ({ ...s, error: null, done: false }));
      setStatus('streaming');

      try {
        const res = await fetch(endpoint, {
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
            files: opts?.files,
          }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`controller stream failed: ${res.status}`);
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
            if (!dataLine) {
              continue;
            }
            const json = dataLine.slice(5).trim();
            if (!json) {
              continue;
            }
            let event: { type: string; [k: string]: unknown };
            try {
              event = JSON.parse(json);
            } catch {
              continue;
            }
            if (event.type === '__thread__' && typeof event.threadId === 'string') {
              threadRef.current = event.threadId;
            }
            setTranscript((s) => reduceAgentControllerEvent(s, event));
          }
          chunk = await reader.read();
        }
        setStatus('ready');
        // A completed turn may have created a new thread (or bumped an existing
        // one) — nudge the sidebar to refetch.
        setRefreshSignal((n) => n + 1);
        // The turn may also have created or paused a schedule — refresh the panel.
        refreshSchedules();
      } catch (err) {
        setTranscript((s) => ({
          ...s,
          error: err instanceof Error ? err.message : String(err),
        }));
        setStatus('error');
      }
    },
    [endpoint, refreshSchedules],
  );

  /**
   * Resolve a parked tool-approval gate. The continuation events arrive on the
   * still-open SSE from the original sendMessage, so this just fires the decision.
   */
  const approve = useCallback(async (decision: 'approve' | 'decline' | 'always_allow_category') => {
    await fetch('/api/agent-controller/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
  }, []);

  /**
   * Answer a parked `ask_user` suspension. Optimistically clear the prompt so it
   * closes at once; the continuation events arrive on the still-open SSE from the
   * original sendMessage (same pattern as `approve`). `answer` is a string (free-text
   * / single choice) or a string[] of chosen labels (multi-select).
   */
  const answerQuestion = useCallback(async (answer: string | string[], toolCallId?: string) => {
    setTranscript((s) => ({ ...s, pendingSuspension: null }));
    await fetch('/api/agent-controller/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer, ...(toolCallId ? { toolCallId } : {}) }),
    });
  }, []);

  /** Clear the workbench Terminal scrollback (the shell buffer is cumulative). */
  const clearTerminal = useCallback(() => {
    setTranscript((s) => ({ ...s, terminal: { ...s.terminal, output: '' } }));
  }, []);

  /**
   * Load a past conversation into the view. Fetches its messages (text-only
   * restore) and seeds a fresh transcript; follow-up turns continue this thread
   * (threadRef) so the server switches to it and memory carries context.
   */
  const openThread = useCallback(
    async (threadId: string) => {
      try {
        const res = await fetch(
          `/api/agent-controller/threads/${encodeURIComponent(threadId)}/messages`,
          {
            cache: 'no-store',
          },
        );
        const data = (await res.json()) as {
          messages?: Array<{
            id: string;
            role: string;
            parts?: Array<{ type: string; text?: string }>;
          }>;
        };
        threadRef.current = threadId;
        setStatus('ready');
        setTranscript({
          ...emptyTranscript(),
          threadId,
          messages: uiMessagesToAgentController(data.messages ?? []),
        });
      } catch {
        threadRef.current = threadId;
        setTranscript({ ...emptyTranscript(), threadId });
      }
      // Re-hydrate the learned OM facts (resource-scoped) onto the fresh transcript.
      refreshMemory();
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
