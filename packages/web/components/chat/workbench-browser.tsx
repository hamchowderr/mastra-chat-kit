'use client';

import { useEffect, useState } from 'react';

type Status = 'connecting' | 'live' | 'error';

/**
 * Browser tab — a live screencast of the harness agent's Chrome (the
 * `@mastra/browser-viewer` instance), streamed as base64 JPEG frames over SSE
 * from `/api/browser/screencast`. Opening this tab launches the browser; the
 * agent's browser tools drive the same window, so you watch what it does.
 *
 * The EventSource is opened on mount (i.e. when the tab becomes active — Radix
 * unmounts inactive tab bodies) and closed on unmount, which stops the screencast.
 */
export function WorkbenchBrowser() {
  const [frame, setFrame] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');

  useEffect(() => {
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
  }, []);

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
