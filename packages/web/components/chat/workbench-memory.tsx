'use client';

import { BrainIcon, EyeIcon, SparklesIcon, ZapIcon } from 'lucide-react';
import type { HarnessMemory } from '@/lib/harness/events';
import { cn } from '@/lib/utils';

/**
 * Memory tab — a live view of the harness agent's **Observational Memory** (698.20/698.35).
 * A background Observer distills durable facts from the conversation and a Reflector
 * compresses them, so the agent recalls context across chats. This surfaces what that
 * loop is doing, folded from the `om_*` events:
 *
 *  - **Token windows** (`om_status`, fires each run) — how far the conversation has
 *    accumulated toward the next observation, and observations toward the next reflection.
 *  - **Buffer status** — whether the Observer/Reflector are idle or running.
 *  - **Latest observations** — the distilled facts, when the loop surfaces them.
 *  - **Activity** — a rolling log of observe / reflect / activate cycles.
 *
 * The Observer/Reflector run on a background loop, so the lifecycle entries arrive as
 * they happen; `om_status` is the always-present snapshot.
 */
export function WorkbenchMemory({ memory }: { memory: HarnessMemory | null }) {
  const status = memory?.status ?? null;
  const hasContent = !!status || !!memory?.observations || (memory?.activity.length ?? 0) > 0;

  // Nothing recorded yet (fresh user, no run): explain what will appear and when.
  // (`!memory` in the guard also narrows `memory` to non-null for the render below.)
  if (!memory || !hasContent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <BrainIcon className="size-4.5" />
        </span>
        <p className="text-pretty text-muted-foreground text-sm">
          Observational Memory distills durable facts from your chats and carries them across
          conversations. The live token windows fill in as you chat; anything it has already learned
          shows here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto">
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <BrainIcon className="size-3.5" />
        </span>
        <span className="font-medium text-sm">Observational Memory</span>
      </div>

      {/* Token windows: progress toward the next observe / reflect. Present once a run has
          emitted an om_status snapshot; hydrated views (facts-only) skip straight to them. */}
      {status ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
          <TokenWindow
            icon={<EyeIcon className="size-3.5" />}
            label="Messages → observation"
            hint="Unobserved message tokens; the Observer runs at the threshold."
            tokens={status.messages.tokens}
            threshold={status.messages.threshold}
            busy={status.observationBuffer.status !== 'idle'}
          />
          <TokenWindow
            icon={<SparklesIcon className="size-3.5" />}
            label="Observations → reflection"
            hint="Observation tokens; the Reflector compresses at the threshold."
            tokens={status.observations.tokens}
            threshold={status.observations.threshold}
            busy={status.reflectionBuffer.status !== 'idle'}
          />
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <StatusPill label="Observer" status={status.observationBuffer.status} />
            <StatusPill label="Reflector" status={status.reflectionBuffer.status} />
            {status.observationBuffer.chunks > 0 && (
              <span className="tabular-nums">{status.observationBuffer.chunks} buffered</span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs italic">
          Send a message to see live memory windows update.
        </p>
      )}

      {/* Distilled observations — the facts OM has learned (hydrated on load or streamed live). */}
      {memory.observations && (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Learned facts
          </p>
          <p className="whitespace-pre-wrap text-pretty text-sm">{memory.observations}</p>
        </div>
      )}

      {/* Activity log — newest first. */}
      {memory.activity.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Activity
          </p>
          {memory.activity
            .slice()
            .reverse()
            .map((a, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: activity is append-only, reversed for display
                key={`${a.kind}-${i}`}
                className="flex items-start gap-2 text-xs"
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center',
                    a.failed ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {a.kind === 'observe' ? (
                    <EyeIcon className="size-3.5" />
                  ) : a.kind === 'reflect' ? (
                    <SparklesIcon className="size-3.5" />
                  ) : (
                    <ZapIcon className="size-3.5" />
                  )}
                </span>
                <span className={cn('text-pretty', a.failed && 'text-destructive')}>
                  {a.detail}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** One token window: a labelled progress bar toward a threshold, with tabular-nums counts. */
function TokenWindow({
  icon,
  label,
  hint,
  tokens,
  threshold,
  busy,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  tokens: number;
  threshold: number;
  busy: boolean;
}) {
  const pct = threshold > 0 ? Math.min(100, Math.round((tokens / threshold) * 100)) : 0;
  const reached = threshold > 0 && tokens >= threshold;
  return (
    <div className="flex flex-col gap-1" title={hint}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
          {icon}
          {label}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {tokens.toLocaleString()} / {threshold.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            reached ? 'bg-emerald-500' : busy ? 'animate-pulse bg-amber-500' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Idle/running status chip for the Observer or Reflector. */
function StatusPill({ label, status }: { label: string; status: string }) {
  const running = status !== 'idle';
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 font-medium',
        running ? 'animate-pulse bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-muted',
      )}
    >
      {label}: {running ? status : 'idle'}
    </span>
  );
}
