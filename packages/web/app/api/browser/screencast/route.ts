import { forward } from '@/lib/mastra-proxy';

// GET /api/browser/screencast → proxy the controller browser screencast SSE (base64
// JPEG frames). Forwards client disconnects so the upstream screencast can stop.
export async function GET(req: Request) {
  return forward(req, '/browser/screencast', { stream: true });
}
