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
 * - The text goes in as an extra system message AFTER the agent's instructions, never
 *   inside them, so the long instruction prefix stays the same from turn to turn and
 *   prompt caching keeps working.
 *
 * It is built from sections (`turnContextSections`, below). Today's date is the first; a
 * project adds its own, for example a business profile or a voice guide, by appending
 * to that list. The chat agent and every subagent read the same list.
 *
 * Subagents get the same text through `withTurnContext` (a subagent definition takes no
 * processors, but its instructions can be dynamic).
 */
import type { AgentControllerSubagent } from '@mastra/core/agent-controller';
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

/** One part of the turn context. Return nothing to leave it out for this turn. */
export type TurnContextSection = (
  args: TurnContextArgs,
) => string | undefined | Promise<string | undefined>;

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
 * its text, or nothing to skip a turn).
 */
export const turnContextSections: TurnContextSection[] = [todaySection];

/** The full turn-context text for these sections, or undefined when every section is empty. */
export async function turnContextText(
  sections: readonly TurnContextSection[],
  args: TurnContextArgs,
): Promise<string | undefined> {
  const texts = await Promise.all(sections.map((section) => section(args)));
  const body = texts.filter((t): t is string => !!t?.trim()).join('\n\n');
  return body || undefined;
}

/**
 * Adds the turn context as a system message after the agent's own system messages, on
 * every model step. System messages are reset at the start of each step, so it is never
 * duplicated.
 */
export class TurnContextProcessor implements Processor<'turn-context'> {
  readonly id = 'turn-context' as const;
  private readonly sections: readonly TurnContextSection[];
  private readonly now: () => Date;

  constructor({
    sections = turnContextSections,
    now = () => new Date(),
  }: { sections?: readonly TurnContextSection[]; now?: () => Date } = {}) {
    this.sections = sections;
    this.now = now;
  }

  async processInputStep({ systemMessages, requestContext }: ProcessInputStepArgs) {
    const content = await turnContextText(this.sections, { requestContext, now: this.now() });
    if (!content) return undefined;
    return { systemMessages: [...systemMessages, { role: 'system' as const, content }] };
  }
}

/**
 * A subagent definition whose instructions carry the same turn context, after its own
 * instructions. Subagents run with a copy of the parent's request context, so they see
 * the user's time zone. Forked subagents run as the parent agent and get the processor.
 */
export function withTurnContext(
  definition: AgentControllerSubagent,
  sections: readonly TurnContextSection[] = turnContextSections,
): AgentControllerSubagent {
  const { instructions } = definition;
  if (typeof instructions !== 'string') return definition;
  return {
    ...definition,
    instructions: async ({ requestContext }) => {
      const context = await turnContextText(sections, { requestContext, now: new Date() });
      return context ? [instructions, context] : instructions;
    },
  };
}
