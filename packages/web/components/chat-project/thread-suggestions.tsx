'use client';

import { ChevronRightIcon, PlayIcon, SparklesIcon } from 'lucide-react';
import type { WorkThreadStatus } from '@/lib/agent-controller/use-threads';
import { ThreadStatus } from './thread-row';

/** One thread the agent offered: what it is, and why it is worth doing. */
export type ThreadSuggestion = { title: string; why: string };

/** A suggestion's thread, once one was started from it in this chat. */
export type StartedSuggestion = { threadId: string; status: WorkThreadStatus | undefined };

/** A title as suggestions and started threads are matched on. */
export function titleKey(title: string): string {
  return title.trim().toLowerCase();
}

/** A thread a chat's `start_thread` call made: which message made it, and its title. */
export type StartedThread = { at: number; title: string; threadId: string };

/** What a chat's threads and suggestion cards were, by message, for matching the two. */
export type ChatThreads = {
  started: StartedThread[];
  /** Each accepted suggestion card: its message, and the titles it offered. */
  cards: Array<{ at: number; titles: string[] }>;
};

/** A chat's started threads and suggestion cards, in order, from its messages. */
export function chatThreads(
  messages: ReadonlyArray<{ content: ReadonlyArray<{ type: string }> }>,
): ChatThreads {
  const started: StartedThread[] = [];
  const cards: ChatThreads['cards'] = [];
  messages.forEach((m, at) => {
    const results = new Map(
      m.content
        .filter((p) => p.type === 'tool_result')
        .map((p) => [(p as { id?: string }).id, (p as { result?: unknown }).result]),
    );
    for (const p of m.content) {
      const call = p as { type: string; id?: string; name?: string; args?: unknown };
      if (call.type !== 'tool_call') continue;
      const r = results.get(call.id);
      if (call.name === 'suggest_threads' && offered(r)) {
        cards.push({ at, titles: suggestionsOf(call.args).map((t) => titleKey(t.title)) });
      }
      const made = r as { threadId?: unknown; title?: unknown } | undefined;
      if (
        call.name === 'start_thread' &&
        typeof made?.threadId === 'string' &&
        typeof made.title === 'string'
      ) {
        started.push({ at, title: made.title, threadId: made.threadId });
      }
    }
  });
  return { started, cards };
}

/**
 * The thread started from a card's suggestion: the first with its title started after the
 * card's message and before a later card offering the same title, so neither an older thread
 * of that name nor one started from another card is taken for it.
 */
export function startedAfter(
  { started, cards }: ChatThreads,
  cardAt: number,
  title: string,
): StartedThread | undefined {
  const key = titleKey(title);
  const until =
    cards.find((c) => c.at > cardAt && c.titles.includes(key))?.at ?? Number.POSITIVE_INFINITY;
  return started.find((t) => t.at > cardAt && t.at < until && titleKey(t.title) === key);
}

/** Whether a `suggest_threads` result offered its card (a refused call offered nothing). */
export function offered(result: unknown): boolean {
  return Array.isArray((result as { suggested?: unknown } | null | undefined)?.suggested);
}

/** The words a Start button sends: the agent then starts the thread with its brief unchanged. */
export function startWords(titles: readonly string[]): string {
  const quoted = titles.map((t) => `"${t}"`);
  return titles.length === 1
    ? `Start the suggested thread ${quoted[0]}.`
    : `Start the suggested threads ${quoted.join(', ')}.`;
}

/** The suggestions in a `suggest_threads` call's input, as the card shows them. */
export function suggestionsOf(args: unknown): ThreadSuggestion[] {
  const threads = (args as { threads?: unknown } | undefined)?.threads;
  if (!Array.isArray(threads)) return [];
  return threads.flatMap((t) => {
    const { title, why } = (t ?? {}) as { title?: unknown; why?: unknown };
    return typeof title === 'string' && title.trim()
      ? [{ title: title.trim(), why: typeof why === 'string' ? why : '' }]
      : [];
  });
}

/**
 * The card a `suggest_threads` call draws under the agent's message: each thread it offers,
 * with why, and a Start button, plus one to start every one not started yet. Starting sends
 * the chat a message naming them, and the agent starts each with the brief it suggested. A
 * suggestion already started shows its thread's status instead, and opens it.
 */
export function ThreadSuggestions({
  suggestions,
  startedOf,
  onStart,
  onOpen,
  disabled = false,
}: {
  suggestions: ThreadSuggestion[];
  /** The thread started from a suggestion in this chat, by its title. */
  startedOf: (title: string) => StartedSuggestion | undefined;
  onStart: (text: string) => void;
  onOpen: (threadId: string) => void;
  /** The chat is answering: starting waits until it is done. */
  disabled?: boolean;
}) {
  if (suggestions.length === 0) return null;
  const waiting = suggestions.filter((s) => !startedOf(s.title));
  return (
    <section
      aria-label="Suggested threads"
      className="my-2 w-full max-w-md overflow-hidden rounded-lg border border-border bg-background"
    >
      <header className="flex items-center gap-2 border-border border-b px-3 py-2">
        <SparklesIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h3 className="min-w-0 flex-1 font-medium text-sm">Start new threads</h3>
        {waiting.length > 1 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onStart(startWords(waiting.map((s) => s.title)))}
            className="h-7 shrink-0 rounded-md bg-primary px-2.5 font-medium text-primary-foreground text-xs transition-[scale,opacity] enabled:active:scale-95 disabled:opacity-50"
          >
            Start {waiting.length} threads
          </button>
        )}
      </header>
      <ul className="divide-y divide-border">
        {suggestions.map((s, i) => {
          const started = startedOf(s.title);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a card's suggestions never change order.
            <li key={i} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-pretty font-medium text-sm">{s.title}</span>
                {s.why && (
                  <span className="block text-pretty text-muted-foreground text-xs">{s.why}</span>
                )}
              </span>
              {started ? (
                <button
                  type="button"
                  onClick={() => onOpen(started.threadId)}
                  aria-label={`Open ${s.title}`}
                  className="group flex h-7 shrink-0 items-center gap-1 rounded-md px-2 transition-colors hover:bg-muted"
                >
                  <ThreadStatus status={started.status ?? 'working'} />
                  <ChevronRightIcon
                    className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onStart(startWords([s.title]))}
                  aria-label={`Start ${s.title}`}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 font-medium text-xs transition-[scale,background-color,opacity] enabled:hover:bg-muted enabled:active:scale-95 disabled:opacity-50"
                >
                  <PlayIcon className="size-3" aria-hidden />
                  Start
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
