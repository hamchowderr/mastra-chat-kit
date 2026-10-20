/**
 * What a work thread is, as its metadata says (lib/work-threads.ts runs them). Kept apart
 * from the engine so the thread routes can read it without pulling in the tool.
 */

/** The thread-metadata key a work thread's state is kept under. */
export const WORK_THREAD_KEY = 'workThread';

/**
 * working: a run is going. needs_you: it stopped for an approval or a question.
 * done: the last run finished. failed: it ended with an error. stopped: it was working
 * when the server restarted, so nothing is running now.
 */
export type WorkThreadStatus = 'working' | 'needs_you' | 'done' | 'failed' | 'stopped';

export type WorkThreadInfo = {
  /** The main chat's thread, which reports go to. */
  parentThreadId: string;
  title: string;
  status: WorkThreadStatus;
};

const STATUSES: ReadonlySet<string> = new Set([
  'working',
  'needs_you',
  'done',
  'failed',
  'stopped',
]);

/** A thread's work-thread state, or undefined for an ordinary thread. */
export function workThreadOf(thread: { metadata?: unknown } | null | undefined) {
  const value = (thread?.metadata as Record<string, unknown> | undefined)?.[WORK_THREAD_KEY];
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.parentThreadId !== 'string' || typeof v.status !== 'string') return undefined;
  if (!STATUSES.has(v.status)) return undefined;
  return {
    parentThreadId: v.parentThreadId,
    title: typeof v.title === 'string' ? v.title : '',
    status: v.status as WorkThreadStatus,
  };
}

/** The tool the main chat's agent calls to start a thread. */
export const START_THREAD_TOOL = 'start_thread';

/** A link a chat skin turns into "open this thread" (see the chat-project skin). */
export function threadLink(threadId: string, title: string): string {
  return `[${title.replace(/[[\]]/g, '')}](#thread=${encodeURIComponent(threadId)})`;
}
