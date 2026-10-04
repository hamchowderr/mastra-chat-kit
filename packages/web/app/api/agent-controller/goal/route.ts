import { forward } from '@/lib/mastra-proxy';

// Goals are agent-driven — the chat agent sets them via its own `setGoal` tool, not a web
// POST. These routes only back the goal card: read the current objective (hydrate on
// reload) and clear it (the card's dismiss control).

// GET /api/agent-controller/goal → the current objective for the session's active thread.
export async function GET(req: Request) {
  return forward(req, '/agent-controller/goal');
}

// DELETE /api/agent-controller/goal → clear the active thread's objective.
export async function DELETE(req: Request) {
  return forward(req, '/agent-controller/goal', { method: 'DELETE' });
}
