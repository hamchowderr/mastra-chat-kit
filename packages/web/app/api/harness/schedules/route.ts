// Same-origin proxy → Mastra server's schedules list endpoint.
// Returns the agent's recurring schedules so the Schedules panel can render them.
const SERVER_URL = process.env.MASTRA_SERVER_URL ?? 'http://localhost:4111';

export async function GET() {
  const upstream = await fetch(`${SERVER_URL}/harness/schedules`, { cache: 'no-store' });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
