import { forward } from '@/lib/mastra-proxy';

// Same-origin proxy → Mastra server's schedules list endpoint.
// Returns the agent's recurring schedules so the Schedules panel can render them.
export async function GET(req: Request) {
  return forward(req, '/agent-controller/schedules');
}
