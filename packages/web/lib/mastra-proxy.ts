// Same-origin proxy to the standalone Mastra server. The web app is pure
// frontend; thread CRUD lives on the server (over Mastra Memory), so these tiny
// Next route handlers forward to it. Keeps Mastra out of the Next webpack graph
// and avoids CORS.
//
// Users and auth (docs/registry.md → "Users and auth"):
// - MASTRA_JWT_SECRET (server-side env, the same value the Mastra server has): every
//   request is signed with a short-lived HS256 JWT. The server rejects unsigned ones.
// - configureChatKitProxy({ getUserId }) (call it once from instrumentation.ts): the
//   signed-in user becomes the JWT `sub`, so the server gives each user their own
//   Session and threads. A request with no user gets 401 and never reaches the server.
// Neither set: the open, single-user default.
import { createHmac } from 'node:crypto';

const SERVER_URL = process.env.MASTRA_SERVER_URL ?? 'http://localhost:4111';

export type ChatKitProxyConfig = {
  /**
   * The signed-in user's id for a request, or null when nobody is signed in. Read it
   * from your auth library (a session cookie, a header your middleware sets).
   */
  getUserId?: (request: Request) => Promise<string | null | undefined> | string | null | undefined;
};

// Kept on globalThis: route handlers and instrumentation.ts are bundled separately, so
// a module-level variable would not be shared between them.
const KEY = Symbol.for('mastra-chat-kit.proxy');
type Holder = { [KEY]?: ChatKitProxyConfig };

/** Set the proxy's host hooks. Call once at startup, from `instrumentation.ts`. */
export function configureChatKitProxy(config: ChatKitProxyConfig): void {
  (globalThis as Holder)[KEY] = config;
}

function proxyConfig(): ChatKitProxyConfig {
  return (globalThis as Holder)[KEY] ?? {};
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** A short-lived HS256 JWT for the Mastra server's MastraJwtAuth. */
export function signServerToken(secret: string, sub: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const body = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({ sub, iat, exp: iat + 300 }),
  )}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** The single-user id the server uses when no user is configured. */
export const SHARED_USER = 'chat-kit-user';

/**
 * The headers that identify a request to the Mastra server, or a 401 Response when a
 * user hook is configured and nobody is signed in.
 */
export async function serverHeaders(request: Request): Promise<Headers | Response> {
  const headers = new Headers();
  const { getUserId } = proxyConfig();
  let user = SHARED_USER;
  if (getUserId) {
    const id = await getUserId(request);
    if (!id) {
      return Response.json({ error: 'not signed in' }, { status: 401 });
    }
    user = id;
  }
  const secret = process.env.MASTRA_JWT_SECRET;
  if (secret) {
    headers.set('authorization', `Bearer ${signServerToken(secret, user)}`);
  }
  return headers;
}

/**
 * Forward a request to the Mastra server and stream its response back.
 *
 * `request` is the incoming request: it supplies the user (see above) and, for
 * streams, the abort signal so a client disconnect stops the run upstream.
 */
export async function forward(
  request: Request,
  path: string,
  init: RequestInit & { stream?: boolean } = {},
): Promise<Response> {
  const auth = await serverHeaders(request);
  if (auth instanceof Response) return auth;
  const { stream, headers: extra, ...rest } = init;
  const headers = new Headers(extra);
  for (const [name, value] of auth) headers.set(name, value);

  const upstream = await fetch(`${SERVER_URL}${path}`, {
    cache: 'no-store',
    ...rest,
    headers,
    ...(stream ? { signal: request.signal } : {}),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type':
        upstream.headers.get('content-type') ?? (stream ? 'text/event-stream' : 'application/json'),
      'cache-control': stream ? 'no-cache, no-transform' : 'no-store',
    },
  });
}

export { SERVER_URL };
