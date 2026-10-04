import { forward } from '@/lib/mastra-proxy';

// Same-origin proxy → Mastra server's Observational-Memory read endpoint.
// Returns the facts OM has distilled so the Memory panel can hydrate on load.
export async function GET(req: Request) {
  return forward(req, '/agent-controller/om');
}
