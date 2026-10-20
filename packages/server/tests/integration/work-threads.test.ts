import type { AgentController } from '@mastra/core/agent-controller';
import { InMemoryStore } from '@mastra/core/storage';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTO_ALLOWED_TOOLS,
  createChatAgentController,
  getWorkThreads,
} from '../../src/mastra/lib/agent-controller';
import { WORK_THREAD_KEY, workThreadOf } from '../../src/mastra/lib/work-thread-info';
import { createWorkThreads } from '../../src/mastra/lib/work-threads';

/**
 * Work threads end to end through AIMock (fixtures/chat.json, "WORK THREADS"): the main
 * chat's agent calls start_thread, the thread runs the brief on a Session of its own, and
 * its outcome lands in the main chat as a saved message, with no model call for it.
 */

async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

let controller: AgentController | undefined;
afterEach(async () => {
  await controller?.destroy();
  controller = undefined;
});

async function setup(resourceId: string) {
  const storage = new InMemoryStore();
  controller = createChatAgentController({ storage, resourceId, browser: null });
  await controller.init();
  const session = await controller.createSession({ resourceId });
  // As getChatSession does: start_thread is one of the tools that never asks.
  for (const tool of AUTO_ALLOWED_TOOLS) session.grantTool(tool);
  await session.thread.create({ title: 'main' });
  const memory = await storage.getStore('memory');
  if (!memory) throw new Error('no memory store');
  const mainThreadId = session.thread.requireId();
  const threads = async () =>
    (await memory.listThreads({ filter: { resourceId } })).threads.filter((t) => workThreadOf(t));
  const mainTexts = async () =>
    (await memory.listMessages({ threadId: mainThreadId })).messages
      .filter((m) => m.role === 'assistant')
      .map((m) =>
        (m.content.parts ?? [])
          .map((p) => (p.type === 'text' ? (p as { text: string }).text : ''))
          .join(''),
      );
  return { session, mainThreadId, threads, mainTexts, controller, storage, memory };
}

describe('work threads (AIMock)', () => {
  it('starts a thread that runs on its own and reports back when done', async () => {
    const { session, mainThreadId, threads, mainTexts } = await setup('u-work-done');

    const ends: unknown[] = [];
    const unsubscribe = session.subscribe((e) => {
      if (e.type === 'agent_end') ends.push(e.reason);
    });
    await session.sendMessage({ content: 'Start a thread to plan the spring newsletter.' });
    unsubscribe();
    // Starting the thread did not cut the main chat's own run short.
    expect(ends).toEqual(['complete']);

    const [work] = await threads();
    expect(work?.title).toBe('Spring newsletter plan');
    expect(workThreadOf(work)?.parentThreadId).toBe(mainThreadId);
    // The user's own Session stays on the main chat.
    expect(session.thread.getId()).toBe(mainThreadId);

    await waitFor(async () => workThreadOf((await threads())[0])?.status === 'done');
    await waitFor(async () => (await mainTexts()).some((t) => t.includes('is done')));
    const report = (await mainTexts()).find((t) => t.includes('is done')) ?? '';
    expect(report).toContain(`(#thread=${work?.id})`);
    // The thread's own last reply, copied without a model call.
    expect(report).toContain('Subject: Spring is here.');
  });

  it('reports a thread that stops for an approval, then finishes once approved', async () => {
    const { session, threads, mainTexts, controller } = await setup('u-work-approve');

    await session.sendMessage({ content: 'Start a thread to check the weather in Oslo.' });
    await waitFor(async () => workThreadOf((await threads())[0])?.status === 'needs_you');
    await waitFor(async () => (await mainTexts()).some((t) => t.includes('needs you')));
    expect((await mainTexts()).find((t) => t.includes('needs you'))).toContain('getWeather');

    // The gate is answered on the thread's own Session, as /approve does with a threadId.
    const [work] = await threads();
    const workThreads = getWorkThreads(controller);
    const workSession = await workThreads?.sessionForThread(work?.id ?? '', 'u-work-approve');
    expect(workSession).toBeDefined();
    expect(workSession).not.toBe(session);
    const [gate] = [...(workSession?.displayState.get().pendingApprovals.values() ?? [])];
    expect(gate?.toolName).toBe('getWeather');
    expect(
      workSession?.respondToToolApproval({
        decision: 'approve',
        toolCallId: gate?.toolCallId ?? '',
      }),
    ).toEqual({ accepted: true });

    await waitFor(async () => workThreadOf((await threads())[0])?.status === 'done');
    await waitFor(async () => (await mainTexts()).some((t) => t.includes('is done')));
  });

  it('gives no session for a thread that is not a work thread of that user', async () => {
    const { mainThreadId, controller } = await setup('u-work-scope');
    const workThreads = getWorkThreads(controller);
    expect(await workThreads?.sessionForThread(mainThreadId, 'u-work-scope')).toBeUndefined();
    expect(await workThreads?.sessionForThread('no-such-thread', 'u-work-scope')).toBeUndefined();
  });

  it("keeps the host's untrusted mark, screens the report, and lets an idle thread go", async () => {
    const resourceId = 'u-work-host';
    const { mainThreadId, threads, mainTexts, controller, storage } = await setup(resourceId);
    const workThreads = createWorkThreads({
      getController: async () => controller,
      storage,
      startsUntrusted: () => true,
      screenReport: (text, thread) => (thread.untrusted ? `[screened] ${text}` : text),
      idleMs: 20,
    });

    const { threadId } = await workThreads.start({
      resourceId,
      parentThreadId: mainThreadId,
      title: 'Spring newsletter plan',
      brief: 'Plan the spring newsletter: three sections and a subject line.',
    });
    expect(workThreadOf((await threads())[0])?.untrusted).toBe(true);
    await waitFor(async () => (await mainTexts()).some((t) => t.includes('is done')));
    expect((await mainTexts()).find((t) => t.includes('is done'))).toContain(
      '[screened] Subject: Spring is here.',
    );

    // Done and idle: its Session is torn down, and opening the thread makes a new one.
    await waitFor(
      async () =>
        (await controller.getSessionByResource(resourceId, `work:${threadId}`)) === undefined,
    );
    const reopened = await workThreads.sessionForThread(threadId, resourceId);
    expect(reopened?.thread.getId()).toBe(threadId);
  });

  it('marks threads an earlier process left working or waiting as stopped', async () => {
    const resourceId = 'u-work-recover';
    const { mainThreadId, threads, controller, storage, memory } = await setup(resourceId);
    const now = new Date();
    for (const [id, status] of [
      ['w-working', 'working'],
      ['w-waiting', 'needs_you'],
      ['w-done', 'done'],
    ] as const) {
      await memory.saveThread({
        thread: {
          id,
          resourceId,
          title: id,
          createdAt: now,
          updatedAt: now,
          metadata: { [WORK_THREAD_KEY]: { parentThreadId: mainThreadId, title: id, status } },
        },
      });
    }
    await createWorkThreads({ getController: async () => controller, storage }).recover();
    const statuses = Object.fromEntries(
      (await threads()).map((t) => [t.id, workThreadOf(t)?.status]),
    );
    expect(statuses).toEqual({ 'w-working': 'stopped', 'w-waiting': 'stopped', 'w-done': 'done' });
  });
});
