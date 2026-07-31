'use client';

import { PlayIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

type Status = 'idle' | 'connecting' | 'live' | 'error';

/**
 * Browser tab — a live screencast of the controller agent's Chrome (the
 * `@mastra/browser-viewer` instance), streamed as base64 JPEG frames over SSE
 * from `/api/browser/screencast`.
 *
 * Connecting to that endpoint *launches* the browser server-side (`browser.launch()`),
 * so we do NOT auto-connect on tab open — merely clicking the Browser tab shouldn't
 * spin up Chrome. The view stays idle until the user explicitly starts the live view;
 * only then do we open the EventSource (and the browser launches). Closing the tab /
 * unmounting stops the screencast.
 */
export function WorkbenchBrowser() {
  const [started, setStarted] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    if (!started) return;
    setStatus('connecting');
    const es = new EventSource('/api/browser/screencast');
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type: string; data?: string; url?: string };
        if (msg.type === 'frame' && msg.data) {
          setFrame(`data:image/jpeg;base64,${msg.data}`);
          setStatus('live');
        } else if (msg.type === 'url' && msg.url) {
          setUrl(msg.url);
        } else if (msg.type === 'error') {
          setStatus('error');
        } else if (msg.type === 'stop') {
          es.close();
        }
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onerror = () => setStatus((s) => (s === 'live' ? s : 'error'));
    return () => es.close();
  }, [started]);

  // Idle: nothing has launched. Offer to start the live view on demand.
  if (!started) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-muted-foreground text-sm">
          Watch the agent browse the web here. Starting the live view launches the agent&rsquo;s
          browser.
        </p>
        <button
          type="button"
          onClick={() => setStarted(true)}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <PlayIcon className="size-3.5" />
          Start live view
        </button>
      </div>
    );
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
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-md border border-border bg-muted/30">
        {frame ? (
          // biome-ignore lint/performance/noImgElement: streamed base64 data-URI frame; next/image can't optimize it
          <img src={frame} alt="Live view of the agent's browser" className="w-full" />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
            {status === 'error'
              ? "Browser unavailable — the agent hasn't opened it yet, or Chrome isn't installed."
              : "Starting the agent's browser…"}
          </div>
        )}
      </div>
    </div>
  );
}
