'use client';

import { PlayIcon, RotateCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

type Status = 'idle' | 'connecting' | 'live' | 'error' | 'ended';

/** An error from `/browser/screencast`: the server's message, and which provider it is. */
type ScreencastError = { error?: string; provider?: string };

/** A hosted browser (BROWSER_PROVIDER=firecrawl) has no local Chrome to be missing. */
const isHosted = (provider?: string) => Boolean(provider?.startsWith('firecrawl'));

/**
 * Browser tab — a live screencast of the controller agent's browser, streamed as base64
 * JPEG frames over SSE from `/api/browser/screencast`.
 *
 * Connecting to that endpoint *launches* the local browser server-side
 * (`browser.launch()`), so we do NOT auto-connect on tab open — merely clicking the
 * Browser tab shouldn't spin up Chrome. The view stays idle until the user explicitly
 * starts the live view. A hosted browser (Firecrawl) is never launched by the panel: the
 * server answers 503 until the agent has opened it in this conversation, and the stream
 * ends with the agent's turn, so the panel offers "Try again" after either. Read with
 * fetch rather than EventSource, so a refusal's status and message reach the panel.
 * Closing the tab / unmounting stops the screencast.
 */
export function WorkbenchBrowser() {
  // Each start (and each "Try again") is a new attempt; 0 means not started.
  const [attempt, setAttempt] = useState(0);
  const [frame, setFrame] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [failure, setFailure] = useState<ScreencastError | null>(null);

  useEffect(() => {
    if (!attempt) return;
    setStatus('connecting');
    setFailure(null);
    const abort = new AbortController();
    (async () => {
      const res = await fetch('/api/browser/screencast', { signal: abort.signal });
      if (!res.ok || !res.body) {
        setFailure((await res.json().catch(() => ({}))) as ScreencastError);
        setStatus('error');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          try {
            const msg = JSON.parse(event.replace(/^data: /, '')) as {
              type: string;
              data?: string;
              url?: string;
            };
            if (msg.type === 'frame' && msg.data) {
              setFrame(`data:image/jpeg;base64,${msg.data}`);
              setStatus('live');
            } else if (msg.type === 'url' && msg.url) {
              setUrl(msg.url);
            } else if (msg.type === 'error') {
              setStatus('error');
            }
          } catch {
            /* ignore malformed frame */
          }
        }
      }
      setStatus((s) => (s === 'error' ? s : 'ended'));
    })().catch(() => {
      if (!abort.signal.aborted) setStatus('error');
    });
    return () => abort.abort();
  }, [attempt]);

  // Idle: nothing has launched. Offer to start the live view on demand.
  if (!attempt) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-muted-foreground text-sm">
          Watch the agent browse the web here. Starting the live view launches the agent&rsquo;s
          browser.
        </p>
        <button
          type="button"
          onClick={() => setAttempt(1)}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <PlayIcon className="size-3.5" />
          Start live view
        </button>
      </div>
    );
  }

  const stopped = status === 'error' || status === 'ended';
  const retry = (
    <button
      type="button"
      onClick={() => setAttempt((n) => n + 1)}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <RotateCwIcon className="size-3.5" />
      Try again
    </button>
  );

  let message = "Starting the agent's browser…";
  if (status === 'error') {
    message = isHosted(failure?.provider)
      ? "The agent hasn't opened the browser in this conversation yet. Try again once it starts browsing."
      : "Browser unavailable — the agent hasn't opened it yet, or Chrome isn't installed.";
  } else if (status === 'ended') {
    message = 'The live view ended: the agent closed the browser.';
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className="truncate rounded bg-muted px-2 py-1 font-mono text-muted-foreground text-xs"
          title={url ?? ''}
        >
          {url ?? 'agent browser'}
        </span>
        {stopped && frame && <span className="ml-auto shrink-0">{retry}</span>}
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-md border border-border bg-muted/30">
        {frame ? (
          // biome-ignore lint/performance/noImgElement: streamed base64 data-URI frame; next/image can't optimize it
          <img src={frame} alt="Live view of the agent's browser" className="w-full" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground text-sm">
            <p>{message}</p>
            {stopped && retry}
          </div>
        )}
      </div>
    </div>
  );
}
