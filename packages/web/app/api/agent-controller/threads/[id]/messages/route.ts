import { proxy } from '@/lib/mastra-proxy';

// GET /api/agent-controller/threads/:id/messages → one conversation's messages (v6
// UIMessages, text-only restore) for hydrating the transcript on reopen.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy(`/agent-controller/threads/${encodeURIComponent(id)}/messages`);
}
