// Same-origin proxy → standalone Mastra server's Agent Harness SSE route.
// Streams the HarnessEvent SSE straight back to the browser. No Mastra import
// here, so nothing heavy enters the Next webpack graph.
const SERVER_URL = process.env.MASTRA_SERVER_URL ?? 'http://localhost:4111';

export async function POST(req: Request) {
  const body = await req.text();

  const upstream = await fetch(`${SERVER_URL}/harness/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    // Forward client disconnects so the harness run can abort upstream.
    signal: req.signal,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'cache-control': 'no-cache',
    },
  });
}
