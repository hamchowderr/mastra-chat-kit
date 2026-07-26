import { proxy } from '@/lib/mastra-proxy';

// POST /api/harness/mode { modeId } → switch the session's active controller mode.
export async function POST(req: Request) {
  return proxy('/harness/mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await req.text(),
  });
}
