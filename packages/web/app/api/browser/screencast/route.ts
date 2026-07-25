import { SERVER_URL } from '@/lib/mastra-proxy';

// GET /api/browser/screencast → proxy the harness browser screencast SSE (base64
// JPEG frames). Forwards client disconnects so the upstream screencast can stop.
export async function GET(req: Request) {
  const upstream = await fetch(`${SERVER_URL}/browser/screencast`, {
    signal: req.signal,
    cache: 'no-store',
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
    },
  });
}
