'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AI_ELEMENTS_DIR,
  type EventGroup,
  elementSourceUrl,
  eventCounts,
  GROUP_ORDER,
  HARNESS_EVENTS,
  type HarnessEventRow,
} from '@/lib/harness-event-map';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'consumed' | 'dropped';

/**
 * /events — the in-product map of the Agent Harness event stream. Every one of the 50
 * `AgentControllerEvent` types the harness emits over `POST /harness/stream`, whether
 * this kit's reducer consumes it today, and the AI Element (or surface) it drives. Where a
 * prompt can trigger an event, it ships a copy button so you can paste it into the chat and
 * watch it happen live. The honest, browsable companion to docs/harness-events.md, kept in
 * sync via lib/harness-event-map.ts.
 */
export default function EventsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const counts = useMemo(() => eventCounts(), []);

  const visible = useMemo(
    () =>
      filter === 'all'
        ? HARNESS_EVENTS
        : HARNESS_EVENTS.filter((e) => (filter === 'consumed' ? e.consumed : !e.consumed)),
    [filter],
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <nav className="mb-6 flex items-center gap-4 text-sm">
        <Link href="/" className="text-muted-foreground hover:text-foreground">
          ← Chat
        </Link>
        <span className="font-medium text-foreground">Harness Events</span>
      </nav>

      <header className="mb-6">
        <h1 className="font-bold text-2xl">Harness events → AI Elements</h1>
        <p className="mt-1 max-w-2xl text-pretty text-muted-foreground text-sm">
          The Agent Harness streams <strong>{counts.total}</strong> event types over{' '}
          <code className="text-xs">POST /harness/stream</code>. This kit&rsquo;s reducer folds{' '}
          <strong>{counts.consumed}</strong> of them into the transcript today; the other{' '}
          <strong>{counts.dropped}</strong> are on the wire but unrendered (mostly by design — see
          each row&rsquo;s note). Where an event is user-triggerable, copy its prompt into the chat
          to watch it happen live; each element also links to its source.
        </p>
      </header>

      {/* Summary counts double as the filter. */}
      <div className="mb-8 grid grid-cols-3 gap-2">
        <SummaryTile
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          count={counts.total}
          label="All events"
          dot="bg-foreground"
        />
        <SummaryTile
          active={filter === 'consumed'}
          onClick={() => setFilter('consumed')}
          count={counts.consumed}
          label="Consumed"
          dot="bg-green-500"
        />
        <SummaryTile
          active={filter === 'dropped'}
          onClick={() => setFilter('dropped')}
          count={counts.dropped}
          label="Dropped"
          dot="bg-muted-foreground/50"
        />
      </div>

      {GROUP_ORDER.map((group) => {
        const rows = visible.filter((e) => e.group === group);
        if (rows.length === 0) {
          return null;
        }
        return <GroupSection key={group} group={group} rows={rows} />;
      })}
    </main>
  );
}

function SummaryTile({
  active,
  onClick,
  count,
  label,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  label: string;
  dot: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition active:scale-[0.96]',
        active
          ? 'border-foreground/30 bg-accent'
          : 'border-border bg-card hover:border-foreground/20',
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className={cn('inline-block size-2 rounded-full', dot)} />
        <span className="font-bold text-xl tabular-nums">{count}</span>
      </span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </button>
  );
}

function GroupSection({ group, rows }: { group: EventGroup; rows: HarnessEventRow[] }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 border-border border-b pb-1 font-bold text-lg">
        {group} <span className="font-normal text-muted-foreground text-sm">({rows.length})</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((e) => (
          <EventRow key={e.type} row={e} />
        ))}
      </ul>
    </section>
  );
}

function EventRow({ row }: { row: HarnessEventRow }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-start sm:gap-4">
      {/* Left: event type + number. */}
      <div className="flex min-w-0 shrink-0 items-start gap-2 sm:w-64">
        <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {String(row.n).padStart(2, '0')}
        </span>
        <div className="flex min-w-0 flex-col">
          <code className="break-all font-semibold text-sm">{row.type}</code>
          <ConsumedChip consumed={row.consumed} />
        </div>
      </div>
      {/* Right: meaning + target + note. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-pretty text-sm">{row.meaning}</p>
        <TargetLine row={row} />
        {row.prompt && <CopyPrompt prompt={row.prompt} />}
        {row.note && <p className="text-pretty text-muted-foreground text-xs italic">{row.note}</p>}
      </div>
    </li>
  );
}

function ConsumedChip({ consumed }: { consumed: boolean }) {
  return (
    <span
      className={cn(
        'mt-1 inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-[11px]',
        consumed
          ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400'
          : 'border-border bg-muted text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'inline-block size-1.5 rounded-full',
          consumed ? 'bg-green-500' : 'bg-muted-foreground/50',
        )}
      />
      {consumed ? 'Consumed' : 'Dropped'}
    </span>
  );
}

/** The event's target: an AI Element (with a source link) or a plain surface label. */
function TargetLine({ row }: { row: HarnessEventRow }) {
  if (!row.element) {
    return (
      <p className="text-muted-foreground text-xs">
        → <span className="text-foreground">{row.target ?? '—'}</span>
      </p>
    );
  }
  const src = elementSourceUrl(row.element);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="text-muted-foreground">→</span>
      <span className="font-medium text-foreground">{row.elementLabel ?? row.element}</span>
      {src ? (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          ‹source›
        </a>
      ) : (
        // No remote configured yet — show the source path as a plain chip (no dead link).
        <code
          className="text-[11px] text-muted-foreground"
          title={`${AI_ELEMENTS_DIR}/${row.element}.tsx`}
        >
          {row.element}.tsx
        </code>
      )}
    </p>
  );
}

/**
 * A copy-paste prompt for triggering an event live. Copies the prompt to the clipboard
 * (paste it into the chat in Harness mode) and shows the text so you know what you'll send.
 */
function CopyPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(prompt).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={copy}
        aria-label="Copy prompt to clipboard"
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 font-medium text-[11px] text-muted-foreground transition-[color,border-color,scale] hover:border-foreground/30 hover:text-foreground active:scale-[0.96]"
      >
        {copied ? <CheckIcon className="size-3 text-green-600" /> : <CopyIcon className="size-3" />}
        {copied ? 'Copied' : 'Copy prompt'}
      </button>
      <span className="text-pretty text-muted-foreground text-xs italic">“{prompt}”</span>
    </div>
  );
}
