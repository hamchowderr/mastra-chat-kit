'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  emptyTranscript,
  type HarnessGoal,
  type HarnessTranscript,
  reduceHarnessEvent,
  uiMessagesToHarness,
} from './events';

export type HarnessStatus = 'ready' | 'streaming' | 'error';

/** One entry in the harness mode catalog (from GET /api/harness/modes). */
export type HarnessMode = { id: string; name: string; description: string };

/**
 * The Agent Harness transport, mirroring `useChat`'s shape (`{ messages,
 * sendMessage, status }`) but speaking the Harness SSE protocol instead of the
 * AI SDK UIMessage stream. POSTs `{ text, threadId }` to the proxy, parses the
 * `data:`-framed SSE, and folds each HarnessEvent into a transcript.
 */
export function useHarnessChat(endpoint = '/api/harness/stream') {
  const [transcript, setTranscript] = useState<HarnessTranscript>(emptyTranscript);
  const [status, setStatus] = useState<HarnessStatus>('ready');
  const threadRef = useRef<string | null>(null);
  // Bumps whenever a turn completes so the conversation sidebar refetches (a new
  // thread appears / an existing one re-sorts to the top).
  const [refreshSignal, setRefreshSignal] = useState(0);
  // The controller mode catalog (Chat / Plan / …), loaded once from the server.
  const [modes, setModes] = useState<HarnessMode[]>([]);

  // Load the mode catalog + the session's current mode on mount. The active mode
  // rides on the transcript (also updated by `mode_changed` over the SSE, e.g. a
  // plan→build transition), so the switcher stays correct mid-run.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/harness/modes', { cache: 'no-store' });
        const data = (await res.json()) as { modes?: HarnessMode[]; current?: string };
        if (cancelled) return;
        setModes(data.modes ?? []);
        if (typeof data.current === 'string') {
          setTranscript((s) => ({ ...s, activeMode: s.activeMode ?? data.current ?? null }));
        }
      } catch {
        // No modes surfaced if the server is unreachable — the switcher just hides.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load any objective already set on the session's active thread (durable across a
  // reload within the server's lifetime). Live updates then arrive as `goal_evaluation`
  // over the SSE and fold onto this via the reducer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/harness/goal', { cache: 'no-store' });
        const data = (await res.json()) as {
          objective?: {
            objective?: string;
            maxRuns?: number;
            runsUsed?: number;
            status?: HarnessGoal['status'];
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
      // NOTE: no optimistic user message — the Harness echoes the user turn as its
      // own `message_start`/`message_end` (role=user) at the start of the run. Adding
      // our own would render the user's message twice (different ids → both kept).
      setTranscript((s) => ({ ...s, error: null, done: false }));
      setStatus('streaming');

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // The composer's model / web-search / attachment selections ride along so
          // the harness honors them: the run switches model via `session.model.switch`,
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
          throw new Error(`harness stream failed: ${res.status}`);
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
            setTranscript((s) => reduceHarnessEvent(s, event));
          }
          chunk = await reader.read();
        }
        setStatus('ready');
        // A completed turn may have created a new thread (or bumped an existing
        // one) — nudge the sidebar to refetch.
        setRefreshSignal((n) => n + 1);
      } catch (err) {
        setTranscript((s) => ({
          ...s,
          error: err instanceof Error ? err.message : String(err),
        }));
        setStatus('error');
      }
    },
    [endpoint],
  );

  /**
   * Resolve a parked tool-approval gate. The continuation events arrive on the
   * still-open SSE from the original sendMessage, so this just fires the decision.
   */
  const approve = useCallback(async (decision: 'approve' | 'decline' | 'always_allow_category') => {
    await fetch('/api/harness/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
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
  const openThread = useCallback(async (threadId: string) => {
    try {
      const res = await fetch(`/api/harness/threads/${encodeURIComponent(threadId)}/messages`, {
        cache: 'no-store',
      });
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
        messages: uiMessagesToHarness(data.messages ?? []),
      });
    } catch {
      threadRef.current = threadId;
      setTranscript({ ...emptyTranscript(), threadId });
    }
  }, []);

  /** Clear the transcript and start a brand-new conversation (server mints a thread). */
  const reset = useCallback(() => {
    threadRef.current = null;
    setStatus('ready');
    setTranscript(emptyTranscript());
  }, []);

  /** Switch the session's controller mode (e.g. Chat ⇄ Plan). Optimistic + confirmed. */
  const switchMode = useCallback(async (modeId: string) => {
    setTranscript((s) => ({ ...s, activeMode: modeId }));
    try {
      const res = await fetch('/api/harness/mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modeId }),
      });
      const data = (await res.json()) as { current?: string };
      if (typeof data.current === 'string') {
        setTranscript((s) => ({ ...s, activeMode: data.current ?? modeId }));
      }
    } catch {
      // Leave the optimistic value; the next run's mode_changed will reconcile.
    }
  }, []);

  /** Clear the active thread's objective (the agent stops goal-driven looping). */
  const clearGoal = useCallback(async () => {
    setTranscript((s) => ({ ...s, goal: null }));
    try {
      await fetch('/api/harness/goal', { method: 'DELETE' });
    } catch {
      // The optimistic clear stands even if the server call fails.
    }
  }, []);

  return {
    transcript,
    status,
    sendMessage,
    approve,
    clearTerminal,
    openThread,
    reset,
    /** The controller mode catalog (Chat / Plan / …). */
    modes,
    /** Switch the active controller mode. */
    switchMode,
    /** The active mode id (null until the catalog loads / first switch). */
    activeMode: transcript.activeMode,
    /** The current goal-run state (null when no objective is set). Set by the agent's own
     *  `setGoal` tool and updated by `goal_evaluation` events; the UI only reads it. */
    goal: transcript.goal,
    /** Clear the active objective (backs the goal card's dismiss control). */
    clearGoal,
    /** The active conversation id (null before the first turn / after reset). */
    activeThreadId: transcript.threadId,
    /** Increments when a turn completes — drives the sidebar refetch. */
    refreshSignal,
  };
}

/** The shared harness transport, lifted to the shell so chat + workbench panel drive one session. */
export type UseHarnessChat = ReturnType<typeof useHarnessChat>;
