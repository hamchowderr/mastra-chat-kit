import { proxy } from '@/lib/mastra-proxy';

// GET /api/agent-controller/threads → list the controller's conversations (newest first).
export async function GET() {
  return proxy('/agent-controller/threads');
}
