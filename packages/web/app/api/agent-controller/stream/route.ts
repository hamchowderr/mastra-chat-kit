import { forward } from '@/lib/mastra-proxy';

// Same-origin proxy → standalone Mastra server's Agent Controller SSE route.
// Streams the AgentControllerEvent SSE straight back to the browser. No Mastra import
// here, so nothing heavy enters the Next webpack graph.
export async function POST(req: Request) {
  return forward(req, '/agent-controller/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await req.text(),
    // Forward client disconnects so the controller run can abort upstream.
    stream: true,
  });
}
