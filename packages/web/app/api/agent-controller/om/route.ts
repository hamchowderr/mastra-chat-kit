// Same-origin proxy → Mastra server's Observational-Memory read endpoint.
// Returns the facts OM has distilled so the Memory panel can hydrate on load.
const SERVER_URL = process.env.MASTRA_SERVER_URL ?? 'http://localhost:4111';

export async function GET() {
  const upstream = await fetch(`${SERVER_URL}/agent-controller/om`, { cache: 'no-store' });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
