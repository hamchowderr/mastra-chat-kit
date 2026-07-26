import { proxy } from '@/lib/mastra-proxy';

// GET /api/harness/threads/search?q= → semantic search over the harness's
// conversations (matches message bodies via the fastembed vector index).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return proxy(`/harness/threads/search?q=${encodeURIComponent(q)}`);
}
