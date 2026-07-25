import { proxy } from '@/lib/mastra-proxy';

// GET /api/harness/threads → list the harness's conversations (newest first).
export async function GET() {
  return proxy('/harness/threads');
}
