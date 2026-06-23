'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  CATEGORY_ORDER,
  type Category,
  ELEMENTS,
  STATUS_META,
  SURFACE_LABEL,
  statusCounts,
  type WiredElement,
  type WireStatus,
} from '@/lib/wiring';

const STATUS_ORDER: WireStatus[] = ['live', 'dormant', 'ui-util', 'showroom'];

/**
 * /status — the in-product wiring map. Every one of the 48 installed AI Elements,
 * grouped by category, tagged with whether a real conversational turn actually
 * drives it (live), whether it is wired but starved of data (dormant), a UI
 * utility, or showroom-only. This is the honest, browsable version of
 * docs/coverage.md — kept in sync via packages/web/lib/wiring.ts.
 */
export default function StatusPage() {
  const [filter, setFilter] = useState<WireStatus | 'all'>('all');
  const counts = useMemo(() => statusCounts(), []);
  const total = ELEMENTS.length;

  const visible = useMemo(
    () => (filter === 'all' ? ELEMENTS : ELEMENTS.filter((e) => e.status === filter)),
    [filter],
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <nav className="mb-6 flex items-center gap-4 text-sm">
        <Link href="/" className="text-muted-foreground hover:text-foreground">
          ← Chat
        </Link>
        <Link href="/showcase" className="text-muted-foreground hover:text-foreground">
          Showroom
        </Link>
        <span className="font-medium text-foreground">Wiring Status</span>
      </nav>

      <header className="mb-6">
        <h1 className="font-bold text-2xl">What's wired vs. what's showroom</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground text-sm">
          All {total} AI Elements render in the{' '}
          <Link href="/showcase" className="underline underline-offset-2">
            Showroom
          </Link>
          . This page is the honest cut: which ones a <em>real conversational turn</em> actually
          drives, which are wired but starved of data, which are UI utilities, and which need a
          different surface entirely (a code agent, a voice pipeline, a workflow canvas, a sandbox).
        </p>
      </header>

      {/* Summary counts — also the filter control. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <SummaryTile
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          count={total}
          label="All elements"
          dot="bg-foreground"
        />
        {STATUS_ORDER.map((s) => (
          <SummaryTile
            key={s}
            active={filter === s}
            onClick={() => setFilter(s)}
            count={counts[s]}
            label={STATUS_META[s].label}
            dot={STATUS_META[s].dot}
          />
        ))}
      </div>

      {/* Legend for the active (or all) statuses. */}
      <div className="mb-8 flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
        {STATUS_ORDER.filter((s) => filter === 'all' || s === filter).map((s) => (
          <div key={s} className="flex items-baseline gap-2 text-xs">
            <span
              className={cn('mt-1 inline-block size-2 shrink-0 rounded-full', STATUS_META[s].dot)}
            />
            <span className="font-medium text-foreground">{STATUS_META[s].label}</span>
            <span className="text-muted-foreground">— {STATUS_META[s].blurb}</span>
          </div>
        ))}
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const rows = visible.filter((e) => e.category === cat);
        if (rows.length === 0) {
          return null;
        }
        return <CategorySection key={cat} category={cat} rows={rows} />;
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

function CategorySection({ category, rows }: { category: Category; rows: WiredElement[] }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 border-border border-b pb-1 font-bold text-lg">
        {category}{' '}
        <span className="font-normal text-muted-foreground text-sm">({rows.length})</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((el) => (
          <ElementRow key={el.module} el={el} />
        ))}
      </ul>
    </section>
  );
}

function ElementRow({ el }: { el: WiredElement }) {
  const meta = STATUS_META[el.status];
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex min-w-0 shrink-0 flex-col sm:w-52">
        <span className="font-semibold text-sm">{el.name}</span>
        <code className="text-muted-foreground text-xs">{el.module}.tsx</code>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-xs',
              meta.chip,
            )}
          >
            <span className={cn('inline-block size-1.5 rounded-full', meta.dot)} />
            {meta.label}
          </span>
          {el.surfaces.map((s) => (
            <span
              key={s}
              className="rounded-full border border-border bg-background px-2 py-0.5 text-muted-foreground text-xs"
            >
              {SURFACE_LABEL[s]}
            </span>
          ))}
        </div>
        <p className="text-muted-foreground text-sm">{el.driver}</p>
      </div>
    </li>
  );
}
