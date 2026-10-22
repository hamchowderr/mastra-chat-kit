import type { ThreadItem, WorkThreadTask } from '@/lib/agent-controller/use-threads';

/** How the thread list sorts threads: by what they need from the person. */
export type Group = 'waiting' | 'working' | 'idle' | 'resolved';

export const GROUPS: ReadonlyArray<{ id: Group; label: string }> = [
  { id: 'waiting', label: 'Waiting on you' },
  { id: 'working', label: 'Working' },
  { id: 'idle', label: 'Idle' },
  { id: 'resolved', label: 'Resolved' },
];

/** Which group a thread is listed under. A thread that works or waits is never Resolved. */
export function groupOf(t: ThreadItem): Group {
  if (t.status === 'needs_you') return 'waiting';
  if (t.status === 'working') return 'working';
  return t.resolved ? 'resolved' : 'idle';
}

/** How long ago, in the list's short form: now, 7m, 3h, 2d. */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** A checklist's progress, as the row's chip shows it: completed of total. */
export function progressOf(tasks: WorkThreadTask[] | undefined): string | null {
  if (!tasks?.length) return null;
  return `${tasks.filter((t) => t.status === 'completed').length}/${tasks.length}`;
}

/**
 * Something a thread made that opens on its own page (a site, a document): the host says what
 * each thread has, and the list and the thread's header link to it.
 */
export type ThreadOutput = {
  /** What it is, for its icon: `site`, or anything else for a generic one. */
  kind: string;
  /** What the link says, e.g. "Open site". */
  label: string;
  href: string;
};
