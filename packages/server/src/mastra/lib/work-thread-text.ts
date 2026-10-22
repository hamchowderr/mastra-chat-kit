/**
 * The words work threads keep and say: a report's text for the main chat, a thread's latest
 * line, its checklist, and the text of a message. Kept apart from the engine
 * (work-threads.ts) so both it and the steering tools can use them.
 */

import { threadLink, type WorkThreadTask } from './work-thread-info';

/** The longest excerpt of a thread's last reply a report carries. */
export const REPORT_EXCERPT_CHARS = 600;

/** The text of a report saved into the main chat. Exported for tests. */
export function reportText(
  title: string,
  threadId: string,
  status: 'done' | 'needs_you' | 'failed',
  detail?: string,
): string {
  const link = threadLink(threadId, title);
  if (status === 'done') {
    return detail ? `${link} is done.\n\n${excerpt(detail)}` : `${link} is done.`;
  }
  if (status === 'needs_you') return `${link} needs you: ${detail ?? 'open it to continue.'}`;
  return `${link} stopped with an error${detail ? `: ${excerpt(detail)}` : '.'}`;
}

export function excerpt(text: string): string {
  const t = text.trim();
  return t.length <= REPORT_EXCERPT_CHARS ? t : `${t.slice(0, REPORT_EXCERPT_CHARS).trimEnd()}…`;
}

/** The longest latest line a thread keeps for its row in the list. */
export const LATEST_CHARS = 140;

/** The first line of some text, cut to `LATEST_CHARS`: a thread's latest line. */
export function line(text: string): string {
  const first =
    text
      .trim()
      .split('\n')
      .find((l) => l.trim()) ?? '';
  const t = first.replace(/^[#>*\-\s]+/, '').trim();
  return t.length <= LATEST_CHARS ? t : `${t.slice(0, LATEST_CHARS - 1).trimEnd()}…`;
}

/** What a thread waits on, as its latest line ("it asked …" reads "Asked …"). */
export function waitingLine(waitingOn: string | undefined): string {
  if (!waitingOn) return 'Waiting for your answer';
  const t = waitingOn.replace(/^it (is )?/, '').replace(/\.$/, '');
  return line(t.charAt(0).toUpperCase() + t.slice(1));
}

/** The checklist kept for a thread: each task's words and status, at most 20. */
export function tasksOf(tasks: unknown): WorkThreadTask[] {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter(
      (t): t is WorkThreadTask =>
        typeof t?.content === 'string' &&
        ['pending', 'in_progress', 'completed'].includes(t?.status),
    )
    .slice(0, 20)
    .map((t) => ({ content: t.content.slice(0, 200), status: t.status }));
}

/** The text of an assistant message, or '' when it has none. */
export function messageText(message: unknown): string {
  const m = message as { role?: string; content?: unknown } | undefined;
  if (m?.role !== 'assistant') return '';
  const content = m.content as { parts?: Array<{ type?: string; text?: string }> } | undefined;
  return (content?.parts ?? [])
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
}
