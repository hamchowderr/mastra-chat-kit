import { forward } from '@/lib/mastra-proxy';

// Same-origin proxy → Mastra server's Agent Controller abort endpoint (the Stop button).
export async function POST(req: Request) {
  return forward(req, '/agent-controller/abort', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await req.text(),
  });
}
