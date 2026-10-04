import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * # Recurring schedules (controller parity)
 *
 * Wraps Mastra's native `mastra.schedules` service — cron-driven, persisted
 * agent schedules — as three agent tools, mirroring the official
 * template-agent-harness `schedule-tools.ts`:
 *
 *  - `start_schedule` — create a recurring schedule that fires the chat agent
 *    with a prompt into THIS conversation's thread. Returns a stable id.
 *  - `stop_schedule`  — pause a schedule by id (reversible; the row survives).
 *  - `list_schedules` — read the agent's current schedules (read-only).
 *
 * Persistence + firing are free: `mastra.schedules.create()` writes the row to
 * the shared libSQL `schedules` store (so it survives a restart) and lazily
 * starts the scheduler + agent-schedule workers; on the next boot the core
 * detects the persisted agent-schedule rows and resumes ticking. No explicit
 * `scheduler` config is required.
 *
 * `ctx.mastra` is the registered Mastra instance (chatAgent is registered on it),
 * so `ctx.mastra.schedules` is the same service the `/agent-controller/schedules` route
 * reads. Guarded: outside a Mastra-backed run (`ctx.mastra` absent) the tools
 * return a clear error rather than throwing an opaque one.
 */

/** Agent id the schedules target — must match the key `chatAgent` is registered under in index.ts. */
const AGENT_ID = 'chat';

/** Flat, JSON-safe view of an agent schedule for tool output + the schedules panel. */
const scheduleView = z.object({
  id: z.string(),
  cron: z.string(),
  prompt: z.string(),
  status: z.enum(['active', 'paused']),
  /** Epoch ms of the next planned fire (0 when paused/unknown). */
  nextFireAt: z.number(),
  name: z.string().optional(),
});
type ScheduleView = z.infer<typeof scheduleView>;

// biome-ignore lint/suspicious/noExplicitAny: AgentSchedule from mastra.schedules (flat view)
function toView(s: any): ScheduleView {
  return {
    id: String(s?.id ?? ''),
    cron: String(s?.cron ?? ''),
    prompt: String(s?.prompt ?? ''),
    status: s?.status === 'paused' ? 'paused' : 'active',
    nextFireAt: typeof s?.nextFireAt === 'number' ? s.nextFireAt : 0,
    ...(s?.name ? { name: String(s.name) } : {}),
  };
}

export const startSchedule = createTool({
  id: 'start_schedule',
  description:
    'Create a recurring schedule that runs a prompt on a cron cadence and posts the result into THIS conversation. Call this when the user wants something to happen repeatedly on a timer — "every morning…", "remind me every hour…", "check X daily…". Returns a schedule id the user can later pause with stop_schedule.',
  inputSchema: z.object({
    cron: z
      .string()
      .describe(
        'A cron expression for the cadence, e.g. "0 9 * * *" (daily at 09:00), "*/30 * * * *" (every 30 min).',
      ),
    prompt: z
      .string()
      .describe('The instruction to run each time the schedule fires (what the agent should do).'),
    name: z.string().optional().describe('Optional short label to distinguish this schedule.'),
  }),
  outputSchema: scheduleView,
  execute: async ({ cron, prompt, name }, ctx) => {
    const schedules = ctx?.mastra?.schedules;
    const threadId = ctx?.agent?.threadId;
    const resourceId = ctx?.agent?.resourceId;
    if (!schedules) {
      throw new Error('Scheduling is unavailable in this context (no Mastra instance).');
    }
    if (!threadId || !resourceId) {
      throw new Error('A conversation thread is required to create a schedule.');
    }
    const created = await schedules.create({
      agentId: AGENT_ID,
      cron,
      prompt,
      threadId,
      resourceId,
      ...(name ? { name } : {}),
    });
    return toView(created);
  },
});

export const stopSchedule = createTool({
  id: 'stop_schedule',
  description:
    'Pause a recurring schedule by id (from start_schedule or list_schedules). The schedule stops firing but is kept, so it can be resumed later. Call this when the user wants to stop or cancel a scheduled task.',
  inputSchema: z.object({
    scheduleId: z.string().describe('The schedule id to pause.'),
  }),
  outputSchema: scheduleView,
  execute: async ({ scheduleId }, ctx) => {
    const schedules = ctx?.mastra?.schedules;
    if (!schedules) {
      throw new Error('Scheduling is unavailable in this context (no Mastra instance).');
    }
    const paused = await schedules.pause(scheduleId);
    return toView(paused);
  },
});

export const listSchedules = createTool({
  id: 'list_schedules',
  description:
    "List the recurring schedules currently set up in this app, with their ids, cron cadence, prompt, and status. Read-only — use it to tell the user what's scheduled or to find a schedule id to pause.",
  inputSchema: z.object({}),
  outputSchema: z.object({ schedules: z.array(scheduleView) }),
  execute: async (_input, ctx) => {
    const schedules = ctx?.mastra?.schedules;
    if (!schedules) {
      return { schedules: [] };
    }
    const rows = await schedules.list({ agentId: AGENT_ID });
    // list() returns the mixed union; agent schedules carry an `agentId`.
    return {
      schedules: (Array.isArray(rows) ? rows : [])
        // biome-ignore lint/suspicious/noExplicitAny: AnySchedule union
        .filter((s: any) => s?.agentId)
        .map(toView),
    };
  },
});
