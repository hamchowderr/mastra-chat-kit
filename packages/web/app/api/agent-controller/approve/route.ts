import { forward } from '@/lib/mastra-proxy';

// Same-origin proxy → Mastra server's Agent Controller approval endpoint.
// Resolves a parked tool-approval gate; the continuation streams on the
// already-open /agent-controller/stream SSE.
export async function POST(req: Request) {
  return forward(req, '/agent-controller/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await req.text(),
  });
}
