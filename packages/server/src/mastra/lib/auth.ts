import { MastraJwtAuth } from '@mastra/auth';

/**
 * Auth for Studio and every /api/* route: a Bearer JWT signed with one shared
 * HS256 secret. No secret, no auth. That is the local-dev default.
 */
export function createServerAuth(secret: string | undefined): MastraJwtAuth | undefined {
  return secret ? new MastraJwtAuth({ secret }) : undefined;
}
