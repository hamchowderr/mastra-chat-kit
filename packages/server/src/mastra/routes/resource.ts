import { createHash } from 'node:crypto';
import { MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context';

/**
 * The resource id (user) a request is for, or undefined for the one shared user.
 *
 * Mastra's auth middleware sets it on the request context when the server runs with
 * MASTRA_JWT_SECRET: the web proxy signs each request with the signed-in user as the
 * token's `sub`, and `mapUserToResourceId` (lib/auth.ts) turns that into the resource
 * id. Without auth nothing sets it, and every route serves the shared Session.
 */
// biome-ignore lint/suspicious/noExplicitAny: the Hono context type is Mastra-internal
export function resourceIdOf(c: any): string | undefined {
  try {
    const id = c.get('requestContext')?.get(MASTRA_RESOURCE_ID_KEY);
    return typeof id === 'string' && id ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Plan files live here, relative to the workspace root. */
export const PLANS_DIR = 'plans';

/**
 * The folder that holds one user's plan files: `plans/u-<hash>`. A hash, not the id
 * itself, so any resource id (an email, a UUID) makes a safe, fixed-length folder name.
 * `write_plan` writes here, and with auth on the workspace routes serve a user nothing
 * outside it.
 */
export function planDirFor(resourceId: string): string {
  return `${PLANS_DIR}/u-${createHash('sha256').update(resourceId).digest('hex').slice(0, 16)}`;
}
