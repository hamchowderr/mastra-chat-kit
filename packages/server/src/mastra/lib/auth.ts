import { MastraJwtAuth } from '@mastra/auth';

/** What a token must carry: a user (`sub`) and an expiry (`exp`). */
export function isAcceptableToken(user: unknown): boolean {
  const u = user as { sub?: unknown; exp?: unknown } | null | undefined;
  return typeof u?.sub === 'string' && u.sub.trim() !== '' && typeof u.exp === 'number';
}

/**
 * MastraJwtAuth that also refuses a token with no user (`sub` missing, blank or not a
 * string) or no expiry (`exp`). Refusing it at authentication answers 401, before
 * anything could map it to a resource id.
 */
class UserJwtAuth extends MastraJwtAuth {
  override async authenticateToken(token: string) {
    const user = await super.authenticateToken(token);
    if (!isAcceptableToken(user)) {
      throw new Error('token must carry a sub (the user) and an exp');
    }
    return user;
  }
}

/**
 * Auth for Studio, every /api/* route and the chat-kit contract routes: a Bearer JWT
 * signed with one shared HS256 secret. No secret, no auth. That is the local-dev default.
 *
 * The token's `sub` is the user and becomes the request's resource id
 * (`mapUserToResourceId`), so the routes drive that user's own Session. The web proxy
 * (lib/mastra-proxy.ts) signs each request that way. With auth on, a request must say
 * who it is for and must expire; it never falls back to a shared user.
 */
export function createServerAuth(secret: string | undefined): MastraJwtAuth | undefined {
  return secret
    ? new UserJwtAuth({
        secret,
        mapUserToResourceId: (user) => String(user.sub).trim(),
      })
    : undefined;
}
