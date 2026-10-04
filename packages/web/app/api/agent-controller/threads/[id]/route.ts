import { forward } from '@/lib/mastra-proxy';

// DELETE /api/agent-controller/threads/:id → hard-delete a controller conversation.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return forward(req, `/agent-controller/threads/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// PATCH /api/agent-controller/threads/:id → archive/unarchive or rename (body: { archived?, title? }).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return forward(req, `/agent-controller/threads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: await req.text(),
  });
}
