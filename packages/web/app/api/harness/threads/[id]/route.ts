import { proxy } from '@/lib/mastra-proxy';

// DELETE /api/harness/threads/:id → hard-delete a harness conversation.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy(`/harness/threads/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// PATCH /api/harness/threads/:id → archive/unarchive or rename (body: { archived?, title? }).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.text();
  return proxy(`/harness/threads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
