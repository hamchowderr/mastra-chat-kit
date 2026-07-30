import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { listSchedules, startSchedule, stopSchedule } from '../../src/mastra/tools/schedule';

/**
 * Recurring schedules (698.18) — the start_schedule / stop_schedule / list_schedules
 * tools over Mastra's native `mastra.schedules` service. Hermetic: a bare Mastra with
 * an InMemoryStore (which implements the `schedules` domain), no model calls, no spend.
 * Proves the acceptance criteria — create returns an id, the row persists + lists, and
 * it can be paused by id — by driving the SAME tool code the chat agent calls, with a
 * fabricated tool context (`ctx.mastra` + `ctx.agent`), exactly as the live controller does.
 *
 * The cron is fixed far in the future so the scheduler tick never fires the agent
 * during the test; `mastra.shutdown()` stops the worker tick loop between cases.
 */
describe('recurring schedules — start/stop/list tools (native mastra.schedules)', () => {
  // A Mastra per test so each starts from an empty schedules store.
  let mastra: Mastra;
  const agent = { threadId: 't-sched', resourceId: 'r-sched', agentId: 'chat' };
  const FUTURE_CRON = '0 0 1 1 *'; // 00:00 on Jan 1 — never within a test run

  afterEach(async () => {
    await mastra?.shutdown();
  });

  it('creates a schedule that returns an id and persists, then pauses it by id', async () => {
    mastra = new Mastra({ storage: new InMemoryStore() });

    // start_schedule → returns a stable id + active status.
    const created = (await startSchedule.execute(
      { cron: FUTURE_CRON, prompt: 'Post the daily standup summary.', name: 'standup' },
      { mastra, agent },
      // biome-ignore lint/suspicious/noExplicitAny: minimal fabricated tool context
    )) as any;
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('active');
    expect(created.cron).toBe(FUTURE_CRON);
    expect(created.prompt).toContain('standup summary');

    // Persisted: the native service can read it straight back by id.
    const fetched = await mastra.schedules.get(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.status).toBe('active');

    // list_schedules surfaces it as a flat view.
    // biome-ignore lint/suspicious/noExplicitAny: tool output
    const listed = (await listSchedules.execute({}, { mastra, agent })) as any;
    expect(listed.schedules.map((s: { id: string }) => s.id)).toContain(created.id);

    // stop_schedule pauses it (reversible — the row survives).
    const paused = (await stopSchedule.execute(
      { scheduleId: created.id },
      { mastra, agent },
      // biome-ignore lint/suspicious/noExplicitAny: tool output
    )) as any;
    expect(paused.id).toBe(created.id);
    expect(paused.status).toBe('paused');

    // And the pause is durable in the store.
    const after = await mastra.schedules.get(created.id);
    expect(after?.status).toBe('paused');
  });

  it('requires a conversation thread to create a schedule', async () => {
    mastra = new Mastra({ storage: new InMemoryStore() });
    await expect(
      // No agent thread/resource → the tool refuses (a schedule fires into a thread).
      startSchedule.execute(
        { cron: FUTURE_CRON, prompt: 'x' },
        { mastra, agent: {} },
        // biome-ignore lint/suspicious/noExplicitAny: fabricated ctx without a thread
      ) as any,
    ).rejects.toThrow(/thread/i);
  });
});
