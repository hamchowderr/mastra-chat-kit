import { forward } from '@/lib/mastra-proxy';

// GET /api/workspace/files → the controller agent's workspace file tree.
export async function GET(req: Request) {
  return forward(req, '/workspace/files');
}
