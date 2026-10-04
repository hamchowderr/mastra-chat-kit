import { forward } from '@/lib/mastra-proxy';

// GET /api/agent-controller/threads → list the controller's conversations (newest first).
export async function GET(req: Request) {
  return forward(req, '/agent-controller/threads');
}
