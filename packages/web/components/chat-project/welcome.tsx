import { ArrowRightIcon, CheckIcon, CircleDashedIcon, InfoIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One line of a project's context: something the project has (or still needs), where it lives,
 * and where to go to change it.
 */
export type ContextRow = {
  label: string;
  detail: string;
  /** `ready` is set up, `missing` still needs doing, `info` is just so. */
  state?: 'ready' | 'missing' | 'info';
  href?: string;
};

const ICONS = {
  ready: <CheckIcon className="size-4 text-emerald-600" aria-hidden />,
  missing: <CircleDashedIcon className="size-4 text-amber-600" aria-hidden />,
  info: <InfoIcon className="size-4 text-muted-foreground" aria-hidden />,
};

/**
 * What the chat works with, shown before its first message: the host's connections, files and
 * memory, each with where to find it. Rows still missing say what they hold back.
 */
export function ContextCard({
  title = 'Your context',
  rows,
  className,
}: {
  title?: string;
  rows: readonly ContextRow[];
  className?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <section
      aria-label={title}
      className={cn(
        'w-full max-w-xl rounded-xl border border-border bg-card text-left shadow-[var(--shadow-float)]',
        className,
      )}
    >
      <h2 className="border-border border-b px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </h2>
      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const body = (
            <>
              <span className="mt-0.5 shrink-0">{ICONS[row.state ?? 'info']}</span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{row.label}</span>
                <span className="text-muted-foreground"> · {row.detail}</span>
              </span>
              {row.href && (
                <ArrowRightIcon
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
            </>
          );
          return (
            <li key={row.label}>
              {row.href ? (
                <a
                  href={row.href}
                  className="flex items-start gap-3 px-4 py-2 transition-colors hover:bg-muted"
                >
                  {body}
                </a>
              ) : (
                <div className="flex items-start gap-3 px-4 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Something the person can start with one click: its title, and the message it sends. */
export type ChatStarter = { title: string; prompt: string; description?: string };

/** Ways to begin, under the box before the chat's first message. Each sends its message. */
export function StarterList({
  starters,
  onStart,
  disabled = false,
}: {
  starters: readonly ChatStarter[];
  onStart: (starter: ChatStarter) => void;
  disabled?: boolean;
}) {
  if (starters.length === 0) return null;
  return (
    <ul
      aria-label="Ways to start"
      className="mx-auto grid w-full max-w-3xl gap-2 px-4 sm:grid-cols-3"
    >
      {starters.map((s) => (
        <li key={s.title}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onStart(s)}
            className="flex h-full w-full flex-col items-start gap-1 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-50"
          >
            <span className="font-medium text-sm">{s.title}</span>
            {s.description && (
              <span className="text-muted-foreground text-xs">{s.description}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
