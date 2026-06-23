import { proxy } from '@/lib/mastra-proxy';

// POST /api/threads/:id/title → generate + persist an AI title for the thread.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy(`/threads/${encodeURIComponent(id)}/title`, { method: 'POST' });
}
