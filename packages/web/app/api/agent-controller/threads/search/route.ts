import { proxy } from '@/lib/mastra-proxy';

// GET /api/agent-controller/threads/search?q= → semantic search over the controller's
// conversations (matches message bodies via the fastembed vector index).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return proxy(`/agent-controller/threads/search?q=${encodeURIComponent(q)}`);
}
