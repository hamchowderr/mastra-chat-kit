// Same-origin proxy → standalone Mastra server's Agent-mode chatRoute.
// Streams the AI SDK v6 UIMessage response straight back to the browser. No
// Mastra import here, so nothing heavy enters the Next webpack graph.
const SERVER_URL = process.env.MASTRA_SERVER_URL ?? 'http://localhost:4111';

export async function POST(req: Request, ctx: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await ctx.params;
  const body = await req.text();

  const upstream = await fetch(`${SERVER_URL}/chat/${agentId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'cache-control': 'no-cache',
    },
  });
}
