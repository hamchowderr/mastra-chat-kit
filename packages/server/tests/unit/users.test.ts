import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createServerAuth } from '../../src/mastra/lib/auth';
import { createControllerRoutes } from '../../src/mastra/routes/controller';
import { createThreadRoutes } from '../../src/mastra/routes/threads';
import { ctx, deps, find } from '../helpers/route-harness';

/**
 * Users and auth. With MASTRA_JWT_SECRET set, the web proxy signs every request with the
 * signed-in user as the JWT `sub`; Mastra's auth maps that to the request's resource id,
 * and every route drives THAT user's Session. Without a secret, nothing sets a resource
 * id and the routes serve the one shared user, exactly as before.
 */

function signHs256(payload: Record<string, unknown>, secret: string): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

const secret = 'test-jwt-secret-at-least-32-characters-long';

describe('auth → resource id', () => {
  it("maps the token's sub to the resource id", async () => {
    const auth = createServerAuth(secret, 'shared');
    const user = await auth?.authenticateToken(signHs256({ sub: 'simone' }, secret));
    expect(auth?.mapUserToResourceId?.(user ?? {})).toBe('simone');
  });

  it('maps a token with no sub to the shared user', async () => {
    const auth = createServerAuth(secret, 'shared');
    const user = await auth?.authenticateToken(signHs256({ role: 'admin' }, secret));
    expect(auth?.mapUserToResourceId?.(user ?? {})).toBe('shared');
  });
});

/** A fake Session holding one user's threads. */
function fakeSession(threads: string[]) {
  return {
    thread: {
      list: vi.fn(async () => threads.map((id) => ({ id, title: id, createdAt: 0, updatedAt: 0 }))),
      listMessages: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
    },
  };
}

describe('routes drive the signed-in user’s Session', () => {
  it('asks for the session of the request’s resource id, or the shared one', async () => {
    const getSession = vi.fn(async () => fakeSession(['t1']) as never);
    const route = find(
      createThreadRoutes(deps({ getSession })),
      '/agent-controller/threads',
      'GET',
    );

    await route.handler(ctx({ resourceId: 'simone' }).c);
    await route.handler(ctx().c);

    expect(getSession).toHaveBeenNthCalledWith(1, 'simone');
    expect(getSession).toHaveBeenNthCalledWith(2, undefined);
  });

  it("won't read or delete another user's thread", async () => {
    const session = fakeSession(['mine']);
    const d = deps({ getSession: async () => session as never });
    const routes = createThreadRoutes(d);

    const read = ctx({ param: { id: 'theirs' }, resourceId: 'simone' });
    await find(routes, '/agent-controller/threads/:id/messages', 'GET').handler(read.c);
    expect(read.captured.status).toBe(404);
    expect(session.thread.listMessages).not.toHaveBeenCalled();

    const del = ctx({ param: { id: 'theirs' }, resourceId: 'simone' });
    await find(routes, '/agent-controller/threads/:id', 'DELETE').handler(del.c);
    expect(del.captured.status).toBe(404);
    expect(session.thread.delete).not.toHaveBeenCalled();

    const own = ctx({ param: { id: 'mine' }, resourceId: 'simone' });
    await find(routes, '/agent-controller/threads/:id/messages', 'GET').handler(own.c);
    expect(own.captured.status).toBe(200);
  });

  it("won't resume another user's thread on /stream", async () => {
    const session = fakeSession(['mine']);
    const route = find(
      createControllerRoutes(deps({ getSession: async () => session as never })),
      '/agent-controller/stream',
      'POST',
    );
    const { c, captured } = ctx({ body: { text: 'hi', threadId: 'theirs' }, resourceId: 'simone' });
    await route.handler(c);
    expect(captured.status).toBe(404);
  });

  it('scopes semantic search to the user', async () => {
    const query = vi.fn(async () => []);
    const route = find(
      createThreadRoutes(deps({ search: { embed: async () => [0.1], query } })),
      '/agent-controller/threads/search',
      'GET',
    );
    await route.handler(ctx({ query: { q: 'grants' }, resourceId: 'simone' }).c);
    expect(query).toHaveBeenCalledWith([0.1], 24, 'simone');
  });
});
