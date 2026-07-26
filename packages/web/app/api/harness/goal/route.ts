import { proxy } from '@/lib/mastra-proxy';

// GET /api/harness/goal → the current objective for the session's active thread.
export async function GET() {
  return proxy('/harness/goal');
}

// POST /api/harness/goal { objective, judgeModelId?, maxRuns? } → set the objective the
// agent iterates toward. Returns the thread id so the client continues that same thread.
export async function POST(req: Request) {
  return proxy('/harness/goal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await req.text(),
  });
}

// DELETE /api/harness/goal → clear the active thread's objective.
export async function DELETE() {
  return proxy('/harness/goal', { method: 'DELETE' });
}
