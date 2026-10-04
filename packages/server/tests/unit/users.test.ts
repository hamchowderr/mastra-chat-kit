import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createServerAuth } from '../../src/mastra/lib/auth';
import { createControllerRoutes } from '../../src/mastra/routes/controller';
import { planDirFor } from '../../src/mastra/routes/resource';
import { createThreadRoutes } from '../../src/mastra/routes/threads';
import { createWorkspaceRoutes } from '../../src/mastra/routes/workspace';
import { listSchedules, stopSchedule } from '../../src/mastra/tools/schedule';
import { callTool } from '../helpers/call-tool';
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

const exp = () => Math.floor(Date.now() / 1000) + 300;

describe('auth → resource id', () => {
  it("maps the token's sub to the resource id", async () => {
    const auth = createServerAuth(secret);
    const user = await auth?.authenticateToken(signHs256({ sub: 'simone', exp: exp() }, secret));
    expect(auth?.mapUserToResourceId?.(user ?? {})).toBe('simone');
  });

  it('refuses a token with no sub, a blank sub or a non-string sub', async () => {
    const auth = createServerAuth(secret);
    for (const payload of [{ role: 'admin' }, { sub: '  ' }, { sub: 42 }]) {
      await expect(
        auth?.authenticateToken(signHs256({ ...payload, exp: exp() }, secret)),
      ).rejects.toThrow();
    }
  });

  it('refuses a token with no exp', async () => {
    const auth = createServerAuth(secret);
    await expect(auth?.authenticateToken(signHs256({ sub: 'simone' }, secret))).rejects.toThrow();
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

describe('workspace files with auth on', () => {
  const tree = [
    {
      name: 'plans',
      path: 'plans',
      type: 'dir' as const,
      children: [
        {
          name: planDirFor('simone').split('/')[1],
          path: planDirFor('simone'),
          type: 'dir' as const,
          children: [{ name: 'a.md', path: `${planDirFor('simone')}/a.md`, type: 'file' as const }],
        },
        {
          name: planDirFor('bob').split('/')[1],
          path: planDirFor('bob'),
          type: 'dir' as const,
          children: [{ name: 'b.md', path: `${planDirFor('bob')}/b.md`, type: 'file' as const }],
        },
      ],
    },
    { name: 'notes.txt', path: 'notes.txt', type: 'file' as const },
  ];
  const readFile = vi.fn(async (p: string) => ({ path: p, content: 'x', truncated: false }));
  const routes = createWorkspaceRoutes(
    deps({ workspace: { root: '/w', readTree: async () => tree, readFile } }),
  );

  it("lists only the user's own plan files", async () => {
    const { c, captured } = ctx({ resourceId: 'simone' });
    await find(routes, '/workspace/files', 'GET').handler(c);
    expect((captured.body as { tree: { path: string }[] }).tree.map((n) => n.path)).toEqual([
      `${planDirFor('simone')}/a.md`,
    ]);
  });

  it('lists everything without auth, as before', async () => {
    const { c, captured } = ctx();
    await find(routes, '/workspace/files', 'GET').handler(c);
    expect((captured.body as { tree: unknown[] }).tree).toHaveLength(2);
  });

  it("refuses another user's plan, a file outside plans, and a .. escape", async () => {
    for (const path of [
      `${planDirFor('bob')}/b.md`,
      'notes.txt',
      `${planDirFor('simone')}/../${planDirFor('bob').split('/')[1]}/b.md`,
    ]) {
      const { c, captured } = ctx({ query: { path }, resourceId: 'simone' });
      await find(routes, '/workspace/file', 'GET').handler(c);
      expect(captured.status).toBe(404);
    }
    const own = ctx({ query: { path: `${planDirFor('simone')}/a.md` }, resourceId: 'simone' });
    await find(routes, '/workspace/file', 'GET').handler(own.c);
    expect(own.captured.status).toBe(200);
  });
});

describe('schedules are per user', () => {
  const rows = [
    { id: 's1', agentId: 'chat', resourceId: 'simone', cron: '0 9 * * *', prompt: 'a' },
    { id: 's2', agentId: 'chat', resourceId: 'bob', cron: '0 9 * * *', prompt: 'b' },
  ];
  const schedules = {
    list: vi.fn(async (f: { resourceId?: string }) =>
      rows.filter((r) => !f.resourceId || r.resourceId === f.resourceId),
    ),
    get: vi.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    pause: vi.fn(async (id: string) => ({ ...rows.find((r) => r.id === id), status: 'paused' })),
  };

  it('the schedules route lists only the signed-in user’s', async () => {
    const route = find(createControllerRoutes(deps()), '/agent-controller/schedules', 'GET');
    const { c, captured } = ctx({ resourceId: 'simone', mastra: { schedules } });
    await route.handler(c);
    expect((captured.body as { schedules: { id: string }[] }).schedules.map((s) => s.id)).toEqual([
      's1',
    ]);
  });

  it('list_schedules lists only the run’s user’s', async () => {
    const out = await callTool<{ schedules: { id: string }[] }>(
      listSchedules,
      {},
      { mastra: { schedules }, agent: { resourceId: 'bob' } },
    );
    expect(out.schedules.map((s) => s.id)).toEqual(['s2']);
  });

  it("stop_schedule won't stop another user's schedule", async () => {
    await expect(
      callTool(
        stopSchedule,
        { scheduleId: 's2' },
        { mastra: { schedules }, agent: { resourceId: 'simone' } },
      ),
    ).rejects.toThrow(/No schedule/);
    expect(schedules.pause).not.toHaveBeenCalled();
    await callTool(
      stopSchedule,
      { scheduleId: 's1' },
      { mastra: { schedules }, agent: { resourceId: 'simone' } },
    );
    expect(schedules.pause).toHaveBeenCalledWith('s1');
  });
});
