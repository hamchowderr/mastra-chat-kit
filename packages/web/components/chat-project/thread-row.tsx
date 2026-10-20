'use client';

import { ChevronRightIcon, MessagesSquareIcon } from 'lucide-react';
import type { WorkThreadStatus } from '@/lib/agent-controller/use-threads';
import { cn } from '@/lib/utils';

/** What each status reads as, and its dot's colour. */
const STATUS: Record<WorkThreadStatus, { label: string; dot: string }> = {
  working: { label: 'Working', dot: 'bg-blue-500 animate-pulse' },
  needs_you: { label: 'Needs you', dot: 'bg-amber-500' },
  done: { label: 'Done', dot: 'bg-emerald-500' },
  failed: { label: 'Failed', dot: 'bg-red-500' },
  stopped: { label: 'Stopped', dot: 'bg-muted-foreground' },
};

/** A thread's status as a dot and a word. */
export function ThreadStatus({ status }: { status: WorkThreadStatus | undefined }) {
  if (!status) return null;
  const s = STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
      <span className={cn('size-1.5 rounded-full', s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

/**
 * The row under a main-chat message that started a thread: its title and how it is
 * doing. Clicking it opens the thread. `threadId` is absent while the thread is still
 * being made.
 */
export function ThreadRow({
  title,
  threadId,
  status,
  onOpen,
}: {
  title: string;
  threadId?: string | undefined;
  status?: WorkThreadStatus | undefined;
  onOpen: (threadId: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={!threadId}
      onClick={() => threadId && onOpen(threadId)}
      className="group flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors enabled:hover:bg-muted disabled:opacity-60"
    >
      <MessagesSquareIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sm">{title || 'Thread'}</span>
        {threadId ? (
          <ThreadStatus status={status ?? 'working'} />
        ) : (
          <span className="text-muted-foreground text-xs">Starting…</span>
        )}
      </span>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground transition-transform group-enabled:group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  );
}

/** The thread id in a `#thread=<id>` link a report carries, or null for any other link. */
export function threadIdFromHref(href: string | null | undefined): string | null {
  const match = href?.match(/^#thread=(.+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
