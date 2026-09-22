import type { ChatServerDeps } from '../../src/mastra/routes/types';

/**
 * Calls route handlers without Hono or a server: a fake context carrying only
 * what the handlers read, a deps object with nothing wired, and a finder that
 * narrows a registered route to its direct handler.
 */

/** Minimal stand-in for the bits of the Hono context the handlers touch. */
export function ctx(
  opts: {
    query?: Record<string, string>;
    param?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
) {
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
        json: () => Promise.resolve(opts.body),
        raw: { signal: opts.signal },
      },
      get: () => {
        throw new Error('handler reached for c.get("mastra") — not expected in this test');
      },
    },
  };
}

/** A deps object with nothing wired up; individual tests override what they need. */
export function deps(over: Partial<ChatServerDeps> = {}): ChatServerDeps {
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

type Routes = ReadonlyArray<{ path: string; method?: string }>;

export const find = <R extends Routes>(routes: R, path: string, method: string) => {
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
  return r as R[number] & { handler: (c: unknown) => Promise<unknown> };
};
