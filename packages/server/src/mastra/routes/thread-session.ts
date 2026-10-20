import type { Session } from '@mastra/core/agent-controller';
import { ownsThread } from './threads';
import type { ChatServerDeps } from './types';

/**
 * The Session a request about `threadId` drives: the thread's own when it is a work
 * thread (`deps.getThreadSession`), else the user's. Null when the request names a
 * thread that is not this user's. No thread named: the user's Session.
 */
export async function sessionForThread(
  deps: ChatServerDeps,
  resourceId: string | undefined,
  threadId: unknown,
): Promise<{ session: Session; work: boolean } | null> {
  const own = await deps.getSession(resourceId);
  if (typeof threadId !== 'string' || !threadId || !deps.getThreadSession) {
    return { session: own, work: false };
  }
  if (!(await ownsThread(own, threadId))) return null;
  const work = await deps.getThreadSession(threadId, resourceId);
  return work ? { session: work, work: true } : { session: own, work: false };
}
