// Same-origin proxy → Mastra server's Agent Controller suspension endpoint.
// Answers a parked `ask_user` prompt. A suspending tool ends the run, so the
// resumed run streams back as SSE on THIS response (not the closed /stream one).
const SERVER_URL = process.env.MASTRA_SERVER_URL ?? 'http://localhost:4111';

export async function POST(req: Request) {
  const body = await req.text();
  const upstream = await fetch(`${SERVER_URL}/agent-controller/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    // Forward client disconnects so the resumed run can abort upstream.
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
