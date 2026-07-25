import { proxy } from '@/lib/mastra-proxy';

// GET /api/harness/threads/search?q= → title/first-message search over the
// harness's conversations.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return proxy(`/harness/threads/search?q=${encodeURIComponent(q)}`);
}
