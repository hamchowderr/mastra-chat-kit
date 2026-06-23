// Same-origin proxy → Mastra server's Agent Harness approval endpoint.
// Resolves a parked tool-approval gate; the continuation streams on the
// already-open /harness/stream SSE.
const SERVER_URL = process.env.MASTRA_SERVER_URL ?? 'http://localhost:4111';

export async function POST(req: Request) {
  const body = await req.text();
  const upstream = await fetch(`${SERVER_URL}/harness/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
