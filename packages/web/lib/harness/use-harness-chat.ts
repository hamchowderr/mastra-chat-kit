'use client';

import { useCallback, useRef, useState } from 'react';
import { emptyTranscript, type HarnessTranscript, reduceHarnessEvent } from './events';

export type HarnessStatus = 'ready' | 'streaming' | 'error';

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

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) {
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
          body: JSON.stringify({ text, threadId: threadRef.current }),
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

  return { transcript, status, sendMessage, approve };
}
