// Same-origin proxy → Mastra server's generated-image store. Returns
// { base64, mediaType } for a generated image id; the UI feeds it to <Image>.
const SERVER_URL = process.env.MASTRA_SERVER_URL ?? 'http://localhost:4111';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const upstream = await fetch(`${SERVER_URL}/images/${id}`);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
