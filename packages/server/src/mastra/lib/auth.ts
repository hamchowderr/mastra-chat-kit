import { MastraJwtAuth } from '@mastra/auth';

/**
 * Auth for Studio, every /api/* route and the chat-kit contract routes: a Bearer JWT
 * signed with one shared HS256 secret. No secret, no auth. That is the local-dev default.
 *
 * The token's `sub` is the user. The web proxy (lib/mastra-proxy.ts) signs each request
 * with the signed-in user's id as `sub`, and `mapUserToResourceId` makes that the
 * request's resource id, so the routes drive that user's own Session. A token with no
 * `sub` (a hand-made Studio token, say) maps to `defaultResourceId`, the shared user.
 */
export function createServerAuth(
  secret: string | undefined,
  defaultResourceId = 'chat-kit-user',
): MastraJwtAuth | undefined {
  return secret
    ? new MastraJwtAuth({
        secret,
        mapUserToResourceId: (user) =>
          typeof user?.sub === 'string' && user.sub.trim() ? user.sub.trim() : defaultResourceId,
      })
    : undefined;
}
