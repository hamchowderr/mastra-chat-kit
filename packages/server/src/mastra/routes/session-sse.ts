import type { Session } from '@mastra/core/agent-controller';

/**
 * Stream a Session's events to the client as SSE while `run` drives it, then close
 * with `__done__`. Shared by /agent-controller/stream (a new message) and
 * /agent-controller/answer (resuming a suspended tool): on core 1.52 a suspending
 * tool ends the run, so the resumed run needs a response of its own to stream on.
 *
 * `decorate` lets a route enrich an event before it's sent. `prelude` events go out
 * before `run` starts. On client disconnect the run is aborted and forwarding stops.
 */
export function sessionEventStream({
  session,
  signal,
  run,
  // biome-ignore lint/suspicious/noExplicitAny: SSE payloads are heterogeneous AgentControllerEvents
  decorate = (event: any) => event,
  prelude = [],
}: {
  session: Session;
  signal?: AbortSignal;
  run: () => Promise<unknown>;
  // biome-ignore lint/suspicious/noExplicitAny: see above
  decorate?: (event: any) => any;
  // biome-ignore lint/suspicious/noExplicitAny: see above
  prelude?: any[];
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Guard every enqueue: once the client disconnects the stream controller
      // closes, but the session keeps emitting events for a few ticks while the
      // run finalizes — enqueueing then throws "Controller is already closed".
      let closed = false;
      // biome-ignore lint/suspicious/noExplicitAny: see above
      const send = (obj: any) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true; // client went away mid-run
        }
      };

      const unsubscribe = session.subscribe((event) => send(decorate(event)));
      // On client disconnect: stop forwarding, drop the subscription, abort the run.
      signal?.addEventListener('abort', () => {
        closed = true;
        unsubscribe();
        session.abort();
      });

      for (const event of prelude) {
        send(event);
      }
      try {
        await run();
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        unsubscribe();
        send({ type: '__done__' });
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
