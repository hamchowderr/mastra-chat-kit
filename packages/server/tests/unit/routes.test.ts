import { describe, expect, it, vi } from 'vitest';
import { createControllerRoutes } from '../../src/mastra/routes/controller';
import { createThreadRoutes } from '../../src/mastra/routes/threads';
import type { ChatServerDeps } from '../../src/mastra/routes/types';
import { createWorkspaceRoutes } from '../../src/mastra/routes/workspace';

/**
 * The route modules are the portable half of this server — the HTTP contract the
 * web chat layer speaks — and nothing exercised them until this file. The suite
 * covered agents, tools and memory, so a refactor of the routes could typecheck,
 * build, and pass 31 tests while having changed behaviour.
 *
 * These are unit tests over the factories: build the routes with a fake deps
 * object and call handlers with a fake Hono context. No Mastra instance, no
 * network, no AIMock.
 */

/** Minimal stand-in for the bits of the Hono context the handlers touch. */
function ctx(opts: { query?: Record<string, string>; param?: Record<string, string> } = {}) {
  const captured: { body?: unknown; status?: number } = {};
  return {
    captured,
    c: {
      json(body: unknown, status?: number) {
        captured.body = body;
        captured.status = status ?? 200;
        return { body, status: status ?? 200 };
      },
      req: {
        query: (k: string) => opts.query?.[k],
        param: (k: string) => opts.param?.[k],
        raw: { signal: undefined },
      },
      get: () => {
        throw new Error('handler reached for c.get("mastra") — not expected in this test');
      },
    },
  };
}

/** A deps object with nothing wired up; individual tests override what they need. */
function deps(over: Partial<ChatServerDeps> = {}): ChatServerDeps {
  return {
    getSession: () => Promise.reject(new Error('getSession not stubbed')),
    getAgentController: () => Promise.reject(new Error('getAgentController not stubbed')),
    agentId: 'chat',
    workspace: {
      root: '/tmp/workspace',
      readTree: () => Promise.resolve([]),
      readFile: () => Promise.resolve(null),
    },
    getImage: () => undefined,
    getBrowser: () => Promise.reject(new Error('getBrowser not stubbed')),
    modelAllowlist: new Set<string>(),
    ...over,
  } as ChatServerDeps;
}

const find = (routes: ReturnType<typeof createThreadRoutes>, path: string, method: string) => {
  const r = routes.find((x) => x.path === path && x.method === method);
  if (!r) {
    throw new Error(`route not registered: ${method} ${path}`);
  }
  // registerApiRoute's return is a union — the `createHandler` variant has no
  // `handler`. Every route here uses the plain-handler form, so narrow rather
  // than casting blindly: if that ever changes, this throws instead of passing
  // a test that silently stopped invoking anything.
  if (!('handler' in r) || typeof r.handler !== 'function') {
    throw new Error(`route ${method} ${path} has no direct handler to invoke`);
  }
  return r as typeof r & { handler: (c: unknown) => Promise<unknown> };
};

describe('the route contract', () => {
  // The web layer fetches these exact paths. Adding or renaming one is a breaking
  // change for every installed consumer, so pin the whole surface.
  it('registers all 16 endpoints the web layer calls', () => {
    const d = deps();
    const all = [
      ...createThreadRoutes(d),
      ...createControllerRoutes(d),
      ...createWorkspaceRoutes(d),
    ].map((r) => `${r.method} ${r.path}`);

    expect(all).toEqual(
      expect.arrayContaining([
        'GET /agent-controller/threads',
        'GET /agent-controller/threads/search',
        'GET /agent-controller/threads/:id/messages',
        'DELETE /agent-controller/threads/:id',
        'PATCH /agent-controller/threads/:id',
        'POST /agent-controller/stream',
        'POST /agent-controller/approve',
        'POST /agent-controller/answer',
        'GET /agent-controller/goal',
        'DELETE /agent-controller/goal',
        'GET /agent-controller/om',
        'GET /agent-controller/schedules',
        'GET /images/:id',
        'GET /workspace/files',
        'GET /workspace/file',
        'GET /browser/screencast',
      ]),
    );
    expect(all).toHaveLength(16);
  });
});

describe('/agent-controller/threads/search — deps.search is optional', () => {
  // The whole point of making search optional: a consumer with no vector index
  // gets a working sidebar instead of a 500. Claimed when the seam was added;
  // this is what actually proves it.
  it('answers { threads: [] } when no search is wired, without touching the session', async () => {
    const getSession = vi.fn(() => Promise.reject(new Error('must not be called')));
    const route = find(
      createThreadRoutes(deps({ getSession })),
      '/agent-controller/threads/search',
      'GET',
    );
    const { c, captured } = ctx({ query: { q: 'anything' } });

    await route.handler(c);

    expect(captured.body).toEqual({ threads: [] });
    expect(captured.status).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('short-circuits a 1-character query without embedding it', async () => {
    const embed = vi.fn(() => Promise.resolve([0.1]));
    const query = vi.fn(() => Promise.resolve([]));
    const route = find(
      createThreadRoutes(deps({ search: { embed, query } })),
      '/agent-controller/threads/search',
      'GET',
    );
    const { c, captured } = ctx({ query: { q: 'a' } });

    await route.handler(c);

    expect(captured.body).toEqual({ threads: [] });
    expect(embed).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('embeds the query and asks for 24 hits when search IS wired', async () => {
    const embed = vi.fn(() => Promise.resolve([0.1, 0.2]));
    const query = vi.fn(() => Promise.resolve([])); // no hits -> early return, no session needed
    const route = find(
      createThreadRoutes(deps({ search: { embed, query } })),
      '/agent-controller/threads/search',
      'GET',
    );
    const { c, captured } = ctx({ query: { q: 'hello world' } });

    await route.handler(c);

    expect(embed).toHaveBeenCalledWith('hello world');
    expect(query).toHaveBeenCalledWith([0.1, 0.2], 24);
    expect(captured.body).toEqual({ threads: [] });
  });
});

describe('workspace routes read through deps, not the wiring', () => {
  it('/images/:id 404s on a miss and returns the bytes on a hit', async () => {
    const img = { base64: 'AAA', mediaType: 'image/png' };
    const routes = createWorkspaceRoutes(
      deps({ getImage: (id) => (id === 'known' ? img : undefined) }),
    );
    const route = find(routes, '/images/:id', 'GET');

    const miss = ctx({ param: { id: 'nope' } });
    await route.handler(miss.c);
    expect(miss.captured.status).toBe(404);

    const hit = ctx({ param: { id: 'known' } });
    await route.handler(hit.c);
    expect(hit.captured.body).toEqual(img);
    expect(hit.captured.status).toBe(200);
  });

  it('/workspace/files echoes the configured root and the tree from deps', async () => {
    const tree = [{ name: 'a.txt', path: 'a.txt', type: 'file' as const }];
    const routes = createWorkspaceRoutes(
      deps({
        workspace: {
          root: '/srv/ws',
          readTree: () => Promise.resolve(tree),
          readFile: () => Promise.resolve(null),
        },
      }),
    );
    const { c, captured } = ctx();

    await find(routes, '/workspace/files', 'GET').handler(c);

    expect(captured.body).toEqual({ root: '/srv/ws', tree });
  });

  it('/workspace/file requires ?path and 404s when the reader finds nothing', async () => {
    const routes = createWorkspaceRoutes(deps());
    const route = find(routes, '/workspace/file', 'GET');

    const noPath = ctx();
    await route.handler(noPath.c);
    expect(noPath.captured.status).toBe(400);

    const missing = ctx({ query: { path: 'gone.txt' } });
    await route.handler(missing.c);
    expect(missing.captured.status).toBe(404);
  });
});

describe('controller routes validate input before touching the session', () => {
  it('/agent-controller/approve rejects an unknown decision with 400', async () => {
    const getSession = vi.fn(() => Promise.reject(new Error('must not be called')));
    const route = find(
      createControllerRoutes(deps({ getSession })),
      '/agent-controller/approve',
      'POST',
    );
    const { c, captured } = ctx();
    const withBody = {
      ...c,
      req: { ...c.req, json: () => Promise.resolve({ decision: 'maybe' }) },
    };

    await route.handler(withBody);

    expect(captured.status).toBe(400);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('/agent-controller/answer rejects a non-string, non-array answer with 400', async () => {
    const getSession = vi.fn(() => Promise.reject(new Error('must not be called')));
    const route = find(
      createControllerRoutes(deps({ getSession })),
      '/agent-controller/answer',
      'POST',
    );
    const { c, captured } = ctx();
    const withBody = {
      ...c,
      req: { ...c.req, json: () => Promise.resolve({ answer: 42 }) },
    };

    await route.handler(withBody);

    expect(captured.status).toBe(400);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('/agent-controller/stream rejects an empty message with 400', async () => {
    const getSession = vi.fn(() => Promise.reject(new Error('must not be called')));
    const route = find(
      createControllerRoutes(deps({ getSession })),
      '/agent-controller/stream',
      'POST',
    );
    const { c, captured } = ctx();
    const withBody = {
      ...c,
      req: { ...c.req, json: () => Promise.resolve({ text: '   ' }) },
    };

    await route.handler(withBody);

    expect(captured.status).toBe(400);
    expect(getSession).not.toHaveBeenCalled();
  });
});
