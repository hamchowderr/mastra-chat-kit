import { proxy } from '@/lib/mastra-proxy';

// GET /api/threads/:id/messages → the thread's messages as v6 UIMessages.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy(`/threads/${encodeURIComponent(id)}/messages`);
}
