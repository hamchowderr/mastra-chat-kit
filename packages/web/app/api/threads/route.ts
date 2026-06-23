import { proxy } from '@/lib/mastra-proxy';

// GET /api/threads → list the local user's chats (newest first, with archived flag).
export async function GET() {
  return proxy('/threads');
}
