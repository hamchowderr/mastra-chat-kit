'use client';

import { CalendarClockIcon, ClockIcon, PauseIcon, RepeatIcon } from 'lucide-react';
import type { HarnessSchedule } from '@/lib/harness/events';
import { cn } from '@/lib/utils';

/**
 * Schedules tab — the recurring schedules the harness agent has set up via its
 * native `mastra.schedules` tools (698.18). Read-only and agent-driven: the user
 * asks the agent to schedule/cancel something (start_schedule / stop_schedule),
 * and this panel reflects the result — no manual create/pause controls, matching
 * how the rest of the harness surfaces capabilities.
 *
 * The list is fetched from `/api/harness/schedules` on mount and refetched when a
 * run settles (see `useHarnessChat.refreshSchedules`), so a schedule the agent
 * just created appears without a reload.
 */
export function WorkbenchSchedules({ schedules }: { schedules: HarnessSchedule[] }) {
  if (schedules.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CalendarClockIcon className="size-4.5" />
        </span>
        <p className="text-pretty text-muted-foreground text-sm">
          No recurring schedules yet. Ask the agent to run something on a timer — “remind me every
          morning to review the changelog” — and it appears here with its cadence and next run.
        </p>
      </div>
    );
  }

  // Active first, then paused; within each, soonest next-fire first.
  const sorted = [...schedules].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.nextFireAt - b.nextFireAt;
  });

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto">
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <CalendarClockIcon className="size-3.5" />
        </span>
        <span className="font-medium text-sm">Schedules</span>
        <span className="ml-auto text-muted-foreground text-xs tabular-nums">{sorted.length}</span>
      </div>

      <div className="flex flex-col gap-2">
        {sorted.map((s) => (
          <ScheduleCard key={s.id} schedule={s} />
        ))}
      </div>
    </div>
  );
}

/** One schedule: its prompt, cron cadence, status, and next-run time. */
function ScheduleCard({ schedule }: { schedule: HarnessSchedule }) {
  const paused = schedule.status === 'paused';
  return (
    // Outer radius (rounded-xl = 12px) − 8px padding → inner chips use rounded-md (6px).
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border bg-card p-3 transition-opacity',
        paused && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-pretty font-medium text-sm leading-snug">
          {schedule.name || schedule.prompt}
        </p>
        <StatusPill paused={paused} />
      </div>
      {/* Show the prompt as a secondary line only when a distinct name titled the card. */}
      {schedule.name && (
        <p className="line-clamp-2 text-pretty text-muted-foreground text-xs">{schedule.prompt}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
        <span className="flex items-center gap-1.5" title="Cron cadence">
          <RepeatIcon className="size-3.5 shrink-0" />
          <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">
            {schedule.cron}
          </code>
        </span>
        {!paused && schedule.nextFireAt > 0 && (
          <span className="flex items-center gap-1.5" title="Next run">
            <ClockIcon className="size-3.5 shrink-0" />
            <span className="tabular-nums">next {formatRelative(schedule.nextFireAt)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** Active/paused chip. Amber-active reads as "live"; muted paused reads as "held". */
function StatusPill({ paused }: { paused: boolean }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[11px]',
        paused
          ? 'bg-muted text-muted-foreground'
          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      )}
    >
      {paused ? <PauseIcon className="size-3" /> : <RepeatIcon className="size-3" />}
      {paused ? 'Paused' : 'Active'}
    </span>
  );
}

/** Compact "in 3h" / "in 2d" style relative time from an epoch-ms timestamp. */
function formatRelative(epochMs: number): string {
  const diff = epochMs - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
