import { proxy } from '@/lib/mastra-proxy';

// GET /api/harness/modes → the harness mode catalog + the session's current mode.
export async function GET() {
  return proxy('/harness/modes');
}
