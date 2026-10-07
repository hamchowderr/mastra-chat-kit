/**
 * # Turn context: what the agent must know on every turn
 *
 * The model has no clock. Without being told, "Friday", "tomorrow" or "next week" resolve
 * against its training data. This module tells it today's date, weekday and time in the
 * user's time zone, fresh on every model step (so resumed runs and long tool loops see
 * the current time too).
 *
 * - The browser sends its IANA time zone with each turn (`timeZone` on the stream and
 *   answer bodies). The route puts it on the request context under `TIME_ZONE_KEY`.
 * - Without one (a scheduled run, an old client, an unknown zone) it falls back to
 *   `DEFAULT_TIMEZONE`, then UTC.
 * - The text goes in as extra system messages AFTER the agent's instructions, never
 *   inside them, so the long instruction prefix stays the same from turn to turn and
 *   prompt caching keeps working.
 *
 * It is built from sections (`turnContextSections`, below). Today's date is the first; a
 * project adds its own, for example a business profile or a voice guide, by appending
 * to that list. The chat agent and every subagent read the same list.
 *
 * ## Prompt caching
 *
 * Anthropic caches the prompt up to each `cache_control` breakpoint it is sent (the AI
 * SDK's `providerOptions.anthropic.cacheControl`; other providers ignore it). The prompt
 * runs tools, then system, then messages, so with `promptCache` on:
 *
 * 1. the last system message before the turn context (the instructions) gets a
 *    breakpoint, which caches the tool schemas and the instructions;
 * 2. sections marked with `stableSection` (text that changes rarely, such as a business
 *    profile) go next, in their own system message with a second breakpoint, so editing
 *    them re-writes only that part of the cache;
 * 3. the other sections (today's date, which changes every minute) go last, with none.
 *
 * The chat agent adds a third on the conversation tail (agents/chat.ts). Anthropic allows
 * four per request and caches nothing shorter than the model's minimum (4096 tokens for
 * Claude Haiku 4.5 and Opus 4.5, 1024 for Sonnet 4.5). A cache write costs 1.25x the
 * input price and a read 0.1x, so one read pays for the write.
 *
 * Subagents get the same messages through `withTurnContext` (a subagent definition takes
 * no processors, but its instructions can be dynamic).
 */
import type { AgentControllerSubagent } from '@mastra/core/agent-controller';
import type { CoreMessage, CoreSystemMessage } from '@mastra/core/llm';
import type { ProcessInputStepArgs, Processor } from '@mastra/core/processors';
import type { RequestContext } from '@mastra/core/request-context';
import { env } from '../../lib/env';
import { isTimeZone, TIME_ZONE_KEY } from './time-zone';

export { isTimeZone, TIME_ZONE_KEY };

/** The zone a turn runs in: the user's, else `DEFAULT_TIMEZONE`, else UTC. */
export function resolveTimeZone(requestContext?: Pick<RequestContext, 'get'>): string {
  const fromUser = requestContext?.get(TIME_ZONE_KEY);
  if (isTimeZone(fromUser)) return fromUser;
  return isTimeZone(env.DEFAULT_TIMEZONE) ? env.DEFAULT_TIMEZONE : 'UTC';
}

/** What a section gets: the turn's request context and the moment the step runs. */
export type TurnContextArgs = { requestContext?: Pick<RequestContext, 'get'>; now: Date };

/**
 * One part of the turn context. Return nothing to leave it out for this turn. A `stable`
 * one (see `stableSection`) goes before the others, behind its own cache breakpoint.
 */
export type TurnContextSection = ((
  args: TurnContextArgs,
) => string | undefined | Promise<string | undefined>) & { readonly stable?: boolean };

/**
 * A section whose text changes rarely (a business profile, a voice guide), so it is
 * cached apart from the date. Its text must stay byte-for-byte the same until it really
 * changes, or every turn re-writes the cache.
 */
export function stableSection(section: TurnContextSection): TurnContextSection {
  return Object.assign((args: TurnContextArgs) => section(args), { stable: true });
}

/** Anthropic's cache breakpoint, as AI SDK provider options. Other providers ignore it. */
export const CACHE_BREAKPOINT = {
  anthropic: { cacheControl: { type: 'ephemeral' } },
} as const;

/** Calendar parts of `date` in `timeZone`. */
function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    iso: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    time: `${get('hour')}:${get('minute')}`,
    offset: get('timeZoneName').replace('GMT', 'UTC') || 'UTC',
  };
}

/**
 * Today's date, weekday and time in the user's zone, plus the dates of the next seven
 * days by weekday, so "Friday" or "next Tuesday" is a lookup, not arithmetic.
 */
export const todaySection: TurnContextSection = ({ requestContext, now }) => {
  const timeZone = resolveTimeZone(requestContext);
  const today = partsIn(now, timeZone);
  // Noon UTC on the zone's calendar date, so adding whole days never crosses a date line.
  const base = Date.parse(`${today.iso}T12:00:00Z`);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base + (i + 1) * 86_400_000);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    return `${weekday} ${d.toISOString().slice(0, 10)}`;
  });
  return [
    `Current date and time: ${today.weekday} ${today.iso}, ${today.time} (${timeZone}, ${today.offset}).`,
    `The next seven days: ${week.join(', ')}.`,
    'Resolve relative dates ("today", "tomorrow", "Friday", "next week") from this date, in this time zone. A weekday on its own means its next date in that list. Write dates as YYYY-MM-DD.',
  ].join('\n');
};

/**
 * The sections every turn carries, in order. Append a project's own here (each returns
 * its text, or nothing to skip a turn); wrap one that changes rarely in `stableSection`.
 */
export const turnContextSections: TurnContextSection[] = [todaySection];

/** The non-empty texts of these sections, joined, or undefined when there are none. */
async function joinSections(
  sections: readonly TurnContextSection[],
  args: TurnContextArgs,
): Promise<string | undefined> {
  const texts = await Promise.all(sections.map((section) => section(args)));
  const body = texts.filter((t): t is string => !!t?.trim()).join('\n\n');
  return body || undefined;
}

/** The turn context in two parts: the stable sections, and the others. */
export async function turnContextParts(
  sections: readonly TurnContextSection[],
  args: TurnContextArgs,
): Promise<{ stable?: string; volatile?: string }> {
  const [stable, volatile] = await Promise.all([
    joinSections(
      sections.filter((s) => s.stable),
      args,
    ),
    joinSections(
      sections.filter((s) => !s.stable),
      args,
    ),
  ]);
  return { stable, volatile };
}

/** `message` with Anthropic's cache breakpoint added to its provider options. */
function withBreakpoint<M extends CoreMessage>(message: M): M {
  const options = message.providerOptions;
  return {
    ...message,
    providerOptions: {
      ...options,
      anthropic: { ...options?.anthropic, ...CACHE_BREAKPOINT.anthropic },
    },
  };
}

/**
 * `prefix` followed by the turn context. With `promptCache`, the prefix's last message
 * and the stable sections each end on a cache breakpoint and the other sections follow
 * in a message of their own; without it, the turn context is one message.
 */
async function withTurnContextMessages<M extends CoreMessage>(
  prefix: readonly M[],
  sections: readonly TurnContextSection[],
  args: TurnContextArgs,
  promptCache: boolean,
): Promise<(M | CoreSystemMessage)[]> {
  const { stable, volatile } = await turnContextParts(sections, args);
  if (!promptCache) {
    const content = [stable, volatile].filter(Boolean).join('\n\n');
    return content ? [...prefix, { role: 'system' as const, content }] : [...prefix];
  }
  const last = prefix.length - 1;
  return [
    ...prefix.map((message, i) => (i === last ? withBreakpoint(message) : message)),
    ...(stable ? [withBreakpoint<CoreSystemMessage>({ role: 'system', content: stable })] : []),
    ...(volatile ? [{ role: 'system' as const, content: volatile }] : []),
  ];
}

/**
 * Adds the turn context after the agent's own system messages, on every model step,
 * with the cache breakpoints above. System messages are reset at the start of each
 * step, so nothing is duplicated.
 */
export class TurnContextProcessor implements Processor<'turn-context'> {
  readonly id = 'turn-context' as const;
  private readonly sections: readonly TurnContextSection[];
  private readonly now: () => Date;
  private readonly promptCache: boolean;

  constructor({
    sections = turnContextSections,
    now = () => new Date(),
    promptCache = env.PROMPT_CACHE,
  }: {
    sections?: readonly TurnContextSection[];
    now?: () => Date;
    /** Add Anthropic cache breakpoints (default: PROMPT_CACHE). */
    promptCache?: boolean;
  } = {}) {
    this.sections = sections;
    this.now = now;
    this.promptCache = promptCache;
  }

  async processInputStep({ systemMessages, requestContext }: ProcessInputStepArgs) {
    return {
      systemMessages: await withTurnContextMessages(
        systemMessages,
        this.sections,
        { requestContext, now: this.now() },
        this.promptCache,
      ),
    };
  }
}

/**
 * A subagent definition whose instructions carry the same turn context, after its own
 * instructions, with the same cache breakpoints. Subagents run with a copy of the
 * parent's request context, so they see the user's time zone. Forked subagents run as
 * the parent agent and get the processor.
 */
export function withTurnContext(
  definition: AgentControllerSubagent,
  sections: readonly TurnContextSection[] = turnContextSections,
  { promptCache = env.PROMPT_CACHE }: { promptCache?: boolean } = {},
): AgentControllerSubagent {
  const { instructions } = definition;
  if (typeof instructions !== 'string') return definition;
  return {
    ...definition,
    instructions: async ({ requestContext }) =>
      withTurnContextMessages(
        [{ role: 'system' as const, content: instructions }],
        sections,
        { requestContext, now: new Date() },
        promptCache,
      ),
  };
}
