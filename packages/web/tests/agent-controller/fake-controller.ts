import { vi } from 'vitest';

/**
 * A fake of the same-origin /api routes the engine calls, for skin tests. `/stream`
 * plays back the given controller events as SSE; `/answer` and `/approve` record what
 * the UI sent and end the run. Every call is kept in `calls` with its parsed body.
 */

type Event = { type: string; [k: string]: unknown };
export type Thread = { id: string; title: string; archived?: boolean };

const sse = (events: Event[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

export function fakeController({
  stream = [],
  answer = [{ type: 'agent_end' }],
  threads = [],
  files = {},
  messages = {},
}: {
  /** The events one /stream call plays back. */
  stream?: Event[];
  /** The events one /answer call (a resumed run) plays back. */
  answer?: Event[];
  threads?: Thread[];
  /** Workspace files by path (a submitted plan is read from one). */
  files?: Record<string, string>;
  /** A thread's stored messages, by thread id, for openThread. */
  messages?: Record<string, Array<{ id: string; role: string; parts: unknown[] }>>;
} = {}) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/agent-controller/stream') return sse(stream);
      if (url === '/api/agent-controller/answer') return sse(answer);
      if (url === '/api/agent-controller/approve') return Response.json({ ok: true });
      if (url === '/api/agent-controller/threads') {
        return Response.json({
          threads: threads.map((t) => ({
            archived: false,
            createdAt: '2026-10-04T00:00:00Z',
            updatedAt: '2026-10-04T00:00:00Z',
            ...t,
          })),
        });
      }
      const thread = url.match(/^\/api\/agent-controller\/threads\/([^/]+)\/messages/);
      if (thread) return Response.json({ messages: messages[decodeURIComponent(thread[1])] ?? [] });
      if (url.startsWith('/api/workspace/file?')) {
        const path = new URL(url, 'http://x').searchParams.get('path') ?? '';
        return path in files
          ? Response.json({ content: files[path] })
          : new Response('not found', { status: 404 });
      }
      return Response.json({});
    }),
  );
  return { calls, sent: (url: string) => calls.filter((c) => c.url === url) };
}

/** An assistant message carrying one tool call, as the controller streams it. */
export const toolCallMessage = (id: string, name: string, args: unknown): Event => ({
  type: 'message_end',
  message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_call', id, name, args }] },
});
