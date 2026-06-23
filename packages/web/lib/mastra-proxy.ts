// Same-origin proxy to the standalone Mastra server. The web app is pure
// frontend; thread CRUD lives on the server (over Mastra Memory), so these tiny
// Next route handlers forward to it. Keeps Mastra out of the Next webpack graph
// and avoids CORS — identical pattern to /api/chat/[agentId].
const SERVER_URL = process.env.MASTRA_SERVER_URL ?? 'http://localhost:4111';

/** Forward a request to the Mastra server and stream its JSON response back. */
export async function proxy(path: string, init?: RequestInit): Promise<Response> {
  const upstream = await fetch(`${SERVER_URL}${path}`, { cache: 'no-store', ...init });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export { SERVER_URL };
