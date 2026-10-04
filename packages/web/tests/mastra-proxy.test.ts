import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureChatKitProxy, forward, signServerToken } from '@/lib/mastra-proxy';

/**
 * The proxy's users-and-auth contract (docs/registry.md → "Users and auth"):
 * - no MASTRA_JWT_SECRET and no user hook → forwards as before, no Authorization header;
 * - a secret → every request carries a short-lived HS256 JWT the server can verify;
 * - a user hook → the signed-in user is the token's `sub`, and a request with no user is
 *   answered 401 here without ever reaching the server.
 */

const SECRET = 'test-jwt-secret-at-least-32-characters-long';

function decode(token: string) {
  const [h, p, sig] = token.split('.');
  const expected = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return { valid: sig === expected, payload: JSON.parse(Buffer.from(p, 'base64url').toString()) };
}

let calls: { url: string; auth: string | null }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return Response.json({ ok: true });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MASTRA_JWT_SECRET;
  configureChatKitProxy({});
});

const req = (headers: Record<string, string> = {}) =>
  new Request('http://app.test/api/agent-controller/threads', { headers });

describe('mastra-proxy', () => {
  it('forwards with no Authorization by default', async () => {
    const res = await forward(req(), '/agent-controller/threads');
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe('http://localhost:4111/agent-controller/threads');
    expect(calls[0].auth).toBeNull();
  });

  it('signs every request when MASTRA_JWT_SECRET is set (shared user)', async () => {
    process.env.MASTRA_JWT_SECRET = SECRET;
    await forward(req(), '/agent-controller/threads');
    const token = calls[0].auth?.replace(/^Bearer /, '') ?? '';
    const { valid, payload } = decode(token);
    expect(valid).toBe(true);
    expect(payload.sub).toBe('chat-kit-user');
    expect(payload.exp - payload.iat).toBe(300);
  });

  it('puts the signed-in user in the token', async () => {
    process.env.MASTRA_JWT_SECRET = SECRET;
    configureChatKitProxy({ getUserId: (r) => r.headers.get('x-test-user') });
    await forward(req({ 'x-test-user': 'simone' }), '/agent-controller/threads');
    expect(decode(calls[0].auth?.replace(/^Bearer /, '') ?? '').payload.sub).toBe('simone');
  });

  it('answers 401 without calling the server when nobody is signed in', async () => {
    configureChatKitProxy({ getUserId: async () => null });
    const res = await forward(req(), '/agent-controller/threads');
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('signs tokens the server can verify', () => {
    const token = signServerToken(SECRET, 'u1', Date.UTC(2026, 0, 1));
    expect(decode(token)).toMatchObject({ valid: true, payload: { sub: 'u1' } });
  });
});
