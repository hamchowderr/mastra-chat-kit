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

/** One step of a thread's progress checklist, as the agent's task tools last left it. */
export type WorkThreadTask = {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
};

export type WorkThreadInfo = {
  /** The main chat's thread, which reports go to. */
  parentThreadId: string;
  title: string;
  status: WorkThreadStatus;
  /** Its progress checklist (the agent's `task_write` list), when it keeps one. */
  tasks?: WorkThreadTask[];
  /** One line on where it is: what it waits on, or the start of its last reply. */
  latest?: string;
  /** The person marked it resolved: listed apart until a new run starts in it. */
  resolved?: boolean;
  /** The specialist agent doing the work, when the host offers several (`agents`). */
  agent?: { id: string; name: string };
  /**
   * The run that started it had read untrusted content, by the host's own rule
   * (`startsUntrusted`). The host applies its rules for such runs to every run here.
   */
  untrusted?: boolean;
};

const STATUSES: ReadonlySet<string> = new Set([
  'working',
  'needs_you',
  'done',
  'failed',
  'stopped',
]);

/** A thread's work-thread state, or undefined for an ordinary thread. */
export function workThreadOf(
  thread: { metadata?: unknown } | null | undefined,
): WorkThreadInfo | undefined {
  const value = (thread?.metadata as Record<string, unknown> | undefined)?.[WORK_THREAD_KEY];
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.parentThreadId !== 'string' || typeof v.status !== 'string') return undefined;
  if (!STATUSES.has(v.status)) return undefined;
  const tasks = Array.isArray(v.tasks) ? v.tasks.filter(isTask) : undefined;
  return {
    parentThreadId: v.parentThreadId,
    title: typeof v.title === 'string' ? v.title : '',
    status: v.status as WorkThreadStatus,
    ...(v.untrusted === true ? { untrusted: true } : {}),
    ...(tasks?.length ? { tasks } : {}),
    ...(typeof v.latest === 'string' && v.latest ? { latest: v.latest } : {}),
    ...(v.resolved === true ? { resolved: true } : {}),
    ...(isAgent(v.agent) ? { agent: { id: v.agent.id, name: v.agent.name } } : {}),
  };
}

function isAgent(value: unknown): value is { id: string; name: string } {
  const a = value as Record<string, unknown> | null;
  return typeof a?.id === 'string' && typeof a.name === 'string';
}

const TASK_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed']);

function isTask(value: unknown): value is WorkThreadTask {
  const t = value as Record<string, unknown> | null;
  return (
    typeof t?.content === 'string' && typeof t.status === 'string' && TASK_STATUSES.has(t.status)
  );
}

/** The tool the main chat's agent calls to start a thread. */
export const START_THREAD_TOOL = 'start_thread';

/** A link a chat skin turns into "open this thread" (see the chat-project skin). */
export function threadLink(threadId: string, title: string): string {
  return `[${title.replace(/[[\]]/g, '')}](#thread=${encodeURIComponent(threadId)})`;
}
