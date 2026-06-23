import { proxy } from '@/lib/mastra-proxy';

// GET /api/threads/search?q=… → semantic chat search (fastembed → PgVector).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return proxy(`/threads/search?q=${encodeURIComponent(q)}`);
}
