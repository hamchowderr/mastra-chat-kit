import { forward } from '@/lib/mastra-proxy';

// Same-origin proxy → Mastra server's Agent Controller suspension endpoint.
// Answers a parked `ask_user` prompt. A suspending tool ends the run, so the
// resumed run streams back as SSE on THIS response (not the closed /stream one).
export async function POST(req: Request) {
  return forward(req, '/agent-controller/answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await req.text(),
    // Forward client disconnects so the resumed run can abort upstream.
    stream: true,
  });
}
