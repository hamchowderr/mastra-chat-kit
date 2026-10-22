'use client';

import {
  AppWindowIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  FunnelIcon,
  GlobeIcon,
  MailIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { ThreadItem } from '@/lib/agent-controller/use-threads';
import { cn } from '@/lib/utils';
import { ago, GROUPS, type Group, groupOf, progressOf, type ThreadOutput } from './thread-groups';

/** A thread output's icon by its kind (site, funnel, email); a window for any other kind. */
const OUTPUT_ICONS: Record<string, typeof GlobeIcon> = {
  site: GlobeIcon,
  funnel: FunnelIcon,
  email: MailIcon,
};

export function OutputIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = OUTPUT_ICONS[kind] ?? AppWindowIcon;
  return <Icon className={cn('size-3.5', className)} aria-hidden />;
}

/** The status word on a row, and its colour; Idle threads say how they ended. */
const WORD: Record<NonNullable<ThreadItem['status']>, { label: string; tone: string }> = {
  working: { label: 'Working', tone: 'text-blue-600 dark:text-blue-400' },
  needs_you: { label: 'Waiting on you', tone: 'text-amber-600 dark:text-amber-400' },
  done: { label: 'Done', tone: 'text-muted-foreground' },
  failed: { label: 'Failed', tone: 'text-red-600 dark:text-red-400' },
  stopped: { label: 'Stopped', tone: 'text-muted-foreground' },
};

/**
 * Every work thread, grouped the way they need attention: Waiting on you, Working, Idle, and
 * Resolved (folded). Each row has the thread's title, its status and latest line, its
 * checklist's progress and when it last moved. Resolving files a finished thread away; a new
 * run in it brings it back.
 */
export function ThreadList({
  threads,
  openThreadId,
  onOpen,
  onResolve,
  disabled,
  outputsOf,
}: {
  threads: ThreadItem[];
  openThreadId: string | null;
  onOpen: (id: string) => void;
  onResolve: (t: ThreadItem, resolved: boolean) => void;
  /** Whether a thread's row can't be opened now (its chat waits on another's answer). */
  disabled?: ((t: ThreadItem) => boolean) | undefined;
  /** What each thread made that opens on its own page, linked from its row. */
  outputsOf?: ((t: ThreadItem) => ThreadOutput[]) | undefined;
}) {
  const [folded, setFolded] = useState<ReadonlySet<Group>>(new Set(['resolved']));
  const waiting = threads.filter((t) => groupOf(t) === 'waiting').length;
  const toggle = (g: Group) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  if (threads.length === 0) {
    return (
      <p className="px-2 py-2 text-pretty text-muted-foreground text-xs">
        Threads show up here when the chat hands work off. Ask for something bigger and it starts
        one.
      </p>
    );
  }

  return (
    <div>
      <p className="px-2 pb-2 text-muted-foreground text-xs">
        {waiting === 0
          ? 'Nothing is waiting on you.'
          : `${waiting} ${waiting === 1 ? 'thread is' : 'threads are'} waiting on you.`}
      </p>
      {GROUPS.map(({ id, label }) => {
        const rows = threads.filter((t) => groupOf(t) === id);
        if (rows.length === 0) return null;
        const open = !folded.has(id);
        return (
          <section key={id} aria-label={label} className="mb-1">
            <button
              type="button"
              onClick={() => toggle(id)}
              aria-expanded={open}
              className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <ChevronDownIcon
                className={cn('size-3.5 transition-transform', !open && '-rotate-90')}
                aria-hidden
              />
              {label}
              <span className="font-normal">{rows.length}</span>
            </button>
            {open &&
              rows.map((t) => (
                <ThreadListRow
                  key={t.id}
                  thread={t}
                  open={t.id === openThreadId}
                  disabled={disabled?.(t) ?? false}
                  onOpen={() => onOpen(t.id)}
                  onResolve={(resolved) => onResolve(t, resolved)}
                  outputs={outputsOf?.(t) ?? []}
                />
              ))}
          </section>
        );
      })}
    </div>
  );
}

function ThreadListRow({
  thread,
  open,
  disabled,
  onOpen,
  onResolve,
  outputs,
}: {
  thread: ThreadItem;
  open: boolean;
  disabled: boolean;
  onOpen: () => void;
  onResolve: (resolved: boolean) => void;
  outputs: ThreadOutput[];
}) {
  const word = thread.status ? WORD[thread.status] : null;
  const progress = progressOf(thread.tasks);
  const group = groupOf(thread);
  // Only a thread that has stopped moving can be filed away.
  const canResolve = group === 'idle';
  return (
    <div
      className={cn(
        'group relative rounded-lg transition-colors',
        open ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        aria-current={open ? 'page' : undefined}
        title={disabled ? 'Wait for the answer to finish' : undefined}
        className="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left disabled:opacity-60"
      >
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-sm">
            {thread.title || 'Thread'}
          </span>
          {progress && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 text-[11px] text-muted-foreground tabular-nums"
              title="Checklist"
            >
              <CircleDashedIcon className="size-3" aria-hidden />
              <span className="sr-only">Checklist </span>
              {progress}
            </span>
          )}
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {ago(thread.updatedAt)}
          </span>
        </span>
        <span className={cn('w-full truncate text-xs', outputs.length > 0 && 'pr-7')}>
          {thread.agent && (
            <span className="text-muted-foreground">
              {thread.agent.name}
              {word || thread.latest ? ' · ' : ''}
            </span>
          )}
          {word && <span className={word.tone}>{word.label}</span>}
          {word && thread.latest && <span className="text-muted-foreground"> · </span>}
          {thread.latest && <span className="text-muted-foreground">{thread.latest}</span>}
        </span>
      </button>
      {outputs.length > 0 && (
        <span
          className={`absolute bottom-0.5 flex ${canResolve || group === 'resolved' ? 'right-9' : 'right-1'}`}
        >
          {outputs.map((o) => (
            <a
              key={o.href}
              href={o.href}
              aria-label={`${o.label}: ${thread.title || 'thread'}`}
              title={o.label}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <OutputIcon kind={o.kind} />
            </a>
          ))}
        </span>
      )}
      {(canResolve || group === 'resolved') && (
        <button
          type="button"
          onClick={(e) => {
            // The row moves to another group; keep focus in the list, on its group's header.
            const list = e.currentTarget.closest('[role="tabpanel"]') as HTMLElement | null;
            const header = e.currentTarget.closest('section')?.querySelector('button');
            onResolve(group !== 'resolved');
            requestAnimationFrame(() => {
              if (header?.isConnected) header.focus();
              else list?.focus();
            });
          }}
          aria-label={
            group === 'resolved'
              ? `Reopen ${thread.title || 'thread'}`
              : `Resolve ${thread.title || 'thread'}`
          }
          title={group === 'resolved' ? 'Reopen' : 'Resolve'}
          className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-md bg-background text-muted-foreground opacity-0 shadow-xs transition-[opacity,color] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"
        >
          {group === 'resolved' ? (
            <RotateCcwIcon className="size-3.5" aria-hidden />
          ) : (
            <CheckIcon className="size-3.5" aria-hidden />
          )}
        </button>
      )}
    </div>
  );
}
