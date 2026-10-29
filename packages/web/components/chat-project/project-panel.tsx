'use client';

import { ChevronRightIcon, MessagesSquareIcon, XIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import type { ThreadItem } from '@/lib/agent-controller/use-threads';
import { cn } from '@/lib/utils';
import type { ThreadOutput } from './thread-groups';
import { OutputIcon, ThreadList } from './thread-list';
import { ThreadStatus } from './thread-row';

/**
 * A tab the host adds to the project's panel beside Threads: the project's files (a Library),
 * its pull requests, its schedules. Its content is the host's own.
 */
export type ProjectTab = {
  id: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
};

/** The built-in tab, every work thread grouped by what it needs. */
export const THREADS_TAB = 'threads';

/**
 * The panel beside the project's chat, as in a Claude project: tabs along the top (Threads,
 * then the host's own), and an open thread in place of the tabs, under a "Threads › title"
 * breadcrumb that goes back to the list.
 */
export function ProjectPanel({
  tab,
  onTab,
  tabs,
  threads,
  openThreadId,
  onOpenThread,
  onResolveThread,
  outputsOf,
  thread,
  onCloseThread,
  onHide,
  closeRef,
  className,
}: {
  tab: string;
  onTab: (id: string) => void;
  tabs: readonly ProjectTab[];
  /** Every work thread, newest first. */
  threads: ThreadItem[];
  openThreadId: string | null;
  onOpenThread: (id: string) => void;
  onResolveThread: (t: ThreadItem, resolved: boolean) => void;
  outputsOf?: ((t: ThreadItem) => ThreadOutput[]) | undefined;
  /** The open thread's conversation and its box, drawn under its header. */
  thread: { item: ThreadItem | undefined; body: ReactNode } | null;
  onCloseThread: () => void;
  /** Hides the whole panel. */
  onHide: () => void;
  /** The open thread's close button, which takes focus when a thread opens. */
  closeRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  const waiting = threads.filter((t) => t.status === 'needs_you').length;
  const all: ProjectTab[] = [
    {
      id: THREADS_TAB,
      label: 'Threads',
      icon: <MessagesSquareIcon className="size-4" aria-hidden />,
      content: (
        <ThreadList
          threads={threads}
          openThreadId={openThreadId}
          onOpen={onOpenThread}
          onResolve={onResolveThread}
          outputsOf={outputsOf}
        />
      ),
    },
    ...tabs,
  ];
  const ids = all.map((t) => t.id);
  const current = ids.includes(tab) ? tab : THREADS_TAB;
  const opened = thread?.item;

  if (thread) {
    return (
      <section
        aria-label={`Thread: ${opened?.title ?? 'Thread'}`}
        className={cn('flex min-h-0 min-w-0 flex-col bg-background', className)}
      >
        <div className="flex items-center gap-2 border-border border-b px-3 py-2">
          <nav aria-label="Thread" className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
            <button
              type="button"
              onClick={onCloseThread}
              aria-label="Back to Threads"
              className="shrink-0 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Threads
            </button>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate font-medium">{opened?.title ?? 'Thread'}</span>
          </nav>
          {opened &&
            outputsOf?.(opened).map((o) => (
              <a
                key={o.href}
                href={o.href}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
              >
                <OutputIcon kind={o.kind} />
                <span className="max-sm:sr-only">{o.label}</span>
              </a>
            ))}
          {opened?.agent && (
            <span
              className="hidden shrink-0 rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs sm:inline"
              title="The agent doing this work"
            >
              {opened.agent.name}
            </span>
          )}
          <ThreadStatus status={opened?.status} />
          <button
            ref={closeRef}
            type="button"
            onClick={onCloseThread}
            aria-label="Close thread"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" aria-hidden />
          </button>
        </div>
        {thread.body}
      </section>
    );
  }

  return (
    <aside aria-label="Project" className={cn('flex min-h-0 min-w-0 flex-col', className)}>
      <div className="flex items-center gap-1 p-2">
        <div
          role="tablist"
          aria-label="Project"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const at = ids.indexOf(current);
            const next = ids[(at + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
            if (!next) return;
            onTab(next);
            document.getElementById(`project-tab-${next}`)?.focus();
          }}
        >
          {all.map((t) => (
            <button
              key={t.id}
              id={`project-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={current === t.id}
              aria-controls={`project-panel-${t.id}`}
              tabIndex={current === t.id ? 0 : -1}
              onClick={() => onTab(t.id)}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-medium text-sm transition-colors',
                current === t.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              {t.icon}
              {t.label}
              {t.id === THREADS_TAB && waiting > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 text-[11px] text-white tabular-nums">
                  <span className="sr-only">, waiting on you: </span>
                  {waiting}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onHide}
          aria-label="Hide panel"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" aria-hidden />
        </button>
      </div>
      {all.map((t) => (
        <div
          key={t.id}
          id={`project-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`project-tab-${t.id}`}
          tabIndex={-1}
          hidden={current !== t.id}
          className="min-h-0 flex-1 overflow-y-auto px-2 py-3 outline-none"
        >
          {t.content}
        </div>
      ))}
    </aside>
  );
}
