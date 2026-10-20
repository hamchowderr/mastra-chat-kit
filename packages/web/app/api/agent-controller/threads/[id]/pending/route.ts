import { forward } from '@/lib/mastra-proxy';

// GET /api/agent-controller/threads/:id/pending → what a work thread waits on: whether its
// run is going, and its parked approvals and questions as stream events.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return forward(req, `/agent-controller/threads/${encodeURIComponent(id)}/pending`);
}
