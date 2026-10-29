'use client';

import { CheckIcon, ChevronDownIcon, CircleIcon, LoaderCircleIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/** A checklist step, as the list keeps it or as a live `task_updated` event carries it. */
type Task = { content?: string; title?: string; status?: string };

/**
 * A thread's progress checklist, pinned above its conversation: each step done, doing or not
 * started, as the thread's agent keeps it with its task tools. Folds to its one-line summary.
 * Nothing shows until the agent writes a list.
 */
export function ThreadChecklist({ tasks }: { tasks: ReadonlyArray<Task> | undefined }) {
  const [open, setOpen] = useState(true);
  const steps = (tasks ?? []).filter((t) => t.content || t.title);
  if (steps.length === 0) return null;
  const done = steps.filter((t) => t.status === 'completed').length;
  return (
    <section
      aria-label="Progress"
      className="mx-3 mt-3 rounded-lg border border-border bg-muted/40 text-sm"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium"
      >
        <span className="flex-1">Progress</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {done}/{steps.length}
        </span>
        <ChevronDownIcon
          className={cn('size-4 text-muted-foreground transition-transform', !open && '-rotate-90')}
          aria-hidden
        />
      </button>
      {open && (
        <ol className="space-y-1 px-3 pb-2.5">
          {steps.map((t, i) => (
            // Steps have no stable id in the list's copy; their order is their identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above.
            <li key={i} className="flex items-start gap-2">
              <StepMark status={t.status} />
              <span
                className={cn(
                  'min-w-0 flex-1 text-pretty',
                  t.status === 'completed' && 'text-muted-foreground',
                  t.status === 'in_progress' && 'font-medium',
                )}
              >
                {t.content || t.title}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StepMark({ status }: { status: string | undefined }) {
  if (status === 'completed') {
    return (
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
        <CheckIcon className="size-3" aria-hidden />
        <span className="sr-only">Done: </span>
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400">
        <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        <span className="sr-only">Doing: </span>
      </span>
    );
  }
  return (
    <span className="mt-0.5 shrink-0 text-muted-foreground">
      <CircleIcon className="size-4" aria-hidden />
      <span className="sr-only">Not started: </span>
    </span>
  );
}
