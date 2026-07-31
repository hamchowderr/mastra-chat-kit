import { proxy } from '@/lib/mastra-proxy';

// GET /api/workspace/file?path=<rel> → one workspace file's text content.
export async function GET(req: Request) {
  const path = new URL(req.url).searchParams.get('path') ?? '';
  return proxy(`/workspace/file?path=${encodeURIComponent(path)}`);
}
