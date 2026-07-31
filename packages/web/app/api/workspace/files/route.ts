import { proxy } from '@/lib/mastra-proxy';

// GET /api/workspace/files → the controller agent's workspace file tree.
export async function GET() {
  return proxy('/workspace/files');
}
