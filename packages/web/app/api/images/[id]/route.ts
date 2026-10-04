import { forward } from '@/lib/mastra-proxy';

// Same-origin proxy → Mastra server's generated-image store. Returns
// { base64, mediaType } for a generated image id; the UI feeds it to <Image>.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return forward(req, `/images/${encodeURIComponent(id)}`);
}
