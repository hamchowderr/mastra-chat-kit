import type { AgentController } from '@mastra/core/agent-controller';
import { InMemoryStore } from '@mastra/core/storage';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTO_ALLOWED_TOOLS,
  createChatAgentController,
  getWorkThreads,
} from '../../src/mastra/lib/agent-controller';
import { WORK_THREAD_KEY, workThreadOf } from '../../src/mastra/lib/work-thread-info';
import {
  LIST_THREADS_TOOL,
  MESSAGE_THREAD_TOOL,
  READ_THREAD_TOOL,
  SUGGEST_THREADS_TOOL,
} from '../../src/mastra/lib/work-thread-steering';
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
    // Its row in the list leads with the start of that reply.
    const latest = workThreadOf((await threads())[0])?.latest ?? '';
    expect(latest.length).toBeGreaterThan(0);
    expect(report).toContain(latest.replace(/…$/, ''));
  });

  it('reports a thread that stops for an approval, then finishes once approved', async () => {
    const { session, threads, mainTexts, controller } = await setup('u-work-approve');

    await session.sendMessage({ content: 'Start a thread to check the weather in Oslo.' });
    await waitFor(async () => workThreadOf((await threads())[0])?.status === 'needs_you');
    await waitFor(async () => (await mainTexts()).some((t) => t.includes('needs you')));
    expect((await mainTexts()).find((t) => t.includes('needs you'))).toContain('getWeather');
    expect(workThreadOf((await threads())[0])?.latest).toBe(
      'Waiting for your OK to run getWeather',
    );

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

  it("runs a thread as the agent it was given, in that agent's mode", async () => {
    const resourceId = 'u-work-agent';
    const { mainThreadId, threads, controller, storage } = await setup(resourceId);
    const workThreads = createWorkThreads({
      getController: async () => controller,
      storage,
      agents: [
        { id: 'helper', name: 'Helper', description: 'Does general work.', modeId: 'chat' },
        { id: 'planner', name: 'Planner', description: 'Plans before acting.', modeId: 'plan' },
      ],
    });
    const planner = { id: 'planner', name: 'Planner', description: '', modeId: 'plan' };
    const started = await workThreads.start({
      resourceId,
      parentThreadId: mainThreadId,
      title: 'Spring newsletter plan',
      brief: 'Plan the spring newsletter: three sections and a subject line.',
      agent: planner,
    });
    expect(started.agent).toBe('Planner');
    expect(workThreadOf((await threads())[0])?.agent).toEqual({ id: 'planner', name: 'Planner' });
    const session = await controller.getSessionByResource(resourceId, `work:${started.threadId}`);
    expect(session?.mode.get()).toBe('plan');
    await waitFor(async () => workThreadOf((await threads())[0])?.status !== 'working');
    // The main chat's own Session keeps its mode.
    expect((await controller.getSessionByResource(resourceId))?.mode.get()).toBe('chat');
  });

  it('opens a thread from before agents in the first agent offered', async () => {
    const resourceId = 'u-work-legacy';
    const { mainThreadId, controller, storage, memory } = await setup(resourceId);
    const now = new Date();
    await memory.saveThread({
      thread: {
        id: 'legacy',
        resourceId,
        title: 'Old work',
        createdAt: now,
        updatedAt: now,
        metadata: {
          [WORK_THREAD_KEY]: { parentThreadId: mainThreadId, title: 'Old work', status: 'done' },
        },
      },
    });
    const workThreads = createWorkThreads({
      getController: async () => controller,
      storage,
      agents: [{ id: 'planner', name: 'Planner', description: 'Plans.', modeId: 'plan' }],
    });
    const session = await workThreads.sessionForThread('legacy', resourceId);
    expect(session?.mode.get()).toBe('plan');
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

  it('queues a thread past the limit and starts it when a slot frees', async () => {
    const resourceId = 'u-work-queue';
    const { mainThreadId, threads, mainTexts, controller, storage, memory } =
      await setup(resourceId);
    const now = new Date();
    const busy = { parentThreadId: mainThreadId, title: 'Busy', status: 'working' };
    await memory.saveThread({
      thread: {
        id: 'w-busy',
        resourceId,
        title: 'Busy',
        createdAt: now,
        updatedAt: now,
        metadata: { [WORK_THREAD_KEY]: busy },
      },
    });
    const workThreads = createWorkThreads({
      getController: async () => controller,
      storage,
      maxWorking: 1,
    });
    const started = await workThreads.start({
      resourceId,
      parentThreadId: mainThreadId,
      title: 'Spring newsletter plan',
      brief: 'Plan the spring newsletter: three sections and a subject line.',
    });
    expect(started.status).toBe('queued');
    const queued = async () =>
      workThreadOf((await threads()).find((t) => t.id === started.threadId));
    expect((await queued())?.status).toBe('queued');
    // Nothing runs for it until a slot frees.
    expect(await controller.getSessionByResource(resourceId, `work:${started.threadId}`)).toBe(
      undefined,
    );
    await workThreads.drain(resourceId);
    expect((await queued())?.status).toBe('queued');

    await memory.updateThreadMetadata({
      id: 'w-busy',
      update: () => ({ [WORK_THREAD_KEY]: { ...busy, status: 'done' } }),
    });
    await workThreads.drain(resourceId);
    await waitFor(async () => (await queued())?.status === 'done');
    await waitFor(async () => (await mainTexts()).some((t) => t.includes('is done')));
  });

  it("lets the main chat list, read and message the threads it started, and no other's", async () => {
    const resourceId = 'u-work-steer';
    const { mainThreadId, threads, mainTexts, controller, storage, memory } =
      await setup(resourceId);
    const workThreads = createWorkThreads({ getController: async () => controller, storage });
    const { threadId } = await workThreads.start({
      resourceId,
      parentThreadId: mainThreadId,
      title: 'Spring newsletter plan',
      brief: 'Plan the spring newsletter: three sections and a subject line.',
    });
    await waitFor(async () => workThreadOf((await threads())[0])?.status === 'done');
    const tools = workThreads.steering;
    const ctx = { agent: { threadId: mainThreadId, resourceId } };
    // Called as the controller calls them: the input, then the run's context.
    // biome-ignore lint/suspicious/noExplicitAny: each tool's result is read loosely here
    type Execute = (input: unknown, c: unknown) => Promise<Record<string, any>>;
    const call = (id: keyof typeof tools, input: unknown, c: unknown = ctx) =>
      (tools[id].execute as unknown as Execute)(input, c);

    const { threads: listed } = await call(LIST_THREADS_TOOL, {});
    expect(listed).toEqual([
      expect.objectContaining({ threadId, title: 'Spring newsletter plan', status: 'done' }),
    ]);
    // The run's own messages go to the Memory's store, which this test keeps apart; the
    // thread's words are read from the controller's store, as the thread routes read them.
    await memory.saveMessages({
      messages: [
        {
          id: 'w-reply',
          role: 'assistant',
          threadId,
          resourceId,
          createdAt: new Date(),
          content: {
            format: 2,
            parts: [{ type: 'text', text: 'Subject: Spring is here.' }],
            content: 'Subject: Spring is here.',
          },
        },
      ],
    });
    const read = await call(READ_THREAD_TOOL, { threadId });
    expect(read.messages.at(-1)).toEqual({
      from: 'thread',
      text: expect.stringContaining('Subject: Spring is here.'),
    });

    const sent = await call(MESSAGE_THREAD_TOOL, {
      threadId,
      message: 'Add a section on spring recipes.',
    });
    expect(sent.delivered).toBe('now');
    await waitFor(async () =>
      (await mainTexts()).some((t) => t.includes('Added a fourth section: spring recipes.')),
    );

    // Another chat of the same user, and the thread itself, can't reach it.
    await expect(
      call(READ_THREAD_TOOL, { threadId }, { agent: { threadId: 'other-chat', resourceId } }),
    ).rejects.toThrow(/no thread with that id/);
    await expect(call(LIST_THREADS_TOOL, {}, { agent: { threadId, resourceId } })).rejects.toThrow(
      /Only the main chat/,
    );

    // Suggesting starts nothing: it names what it offered, and only the main chat offers.
    const offer = { threads: [{ title: 'Summer plan', why: 'Next season.', brief: 'Plan it.' }] };
    expect(await call(SUGGEST_THREADS_TOOL, offer)).toEqual({ suggested: ['Summer plan'] });
    expect(await threads()).toHaveLength(1);
    await expect(
      call(SUGGEST_THREADS_TOOL, offer, { agent: { threadId, resourceId } }),
    ).rejects.toThrow(/Only the main chat/);
  });

  it('refuses suggestions from a run that read untrusted content, with the host mark', async () => {
    const resourceId = 'u-work-suggest-untrusted';
    const { mainThreadId, controller, storage } = await setup(resourceId);
    const { RequestContext } = await import('@mastra/core/request-context');
    const workThreads = createWorkThreads({
      getController: async () => controller,
      storage,
      startsUntrusted: (rc) => (rc as InstanceType<typeof RequestContext>)?.get('tainted') === true,
      refusedSuggestion: { taint: 'host-mark' },
    });
    const tainted = new RequestContext();
    tainted.set('tainted', true);
    // biome-ignore lint/suspicious/noExplicitAny: the tool's result is read loosely here
    type Execute = (input: unknown, c: unknown) => Promise<Record<string, any>>;
    const suggest = workThreads.steering[SUGGEST_THREADS_TOOL].execute as unknown as Execute;
    const offer = { threads: [{ title: 'Summer plan', why: 'Next season.', brief: 'Plan it.' }] };
    const agent = { threadId: mainThreadId, resourceId };
    // Refused as a result carrying the host's mark, so the chat's next runs see it.
    expect(await suggest(offer, { agent, requestContext: tainted })).toEqual({
      refused: expect.stringMatching(/read outside content/),
      taint: 'host-mark',
    });
    expect(await suggest(offer, { agent, requestContext: new RequestContext() })).toEqual({
      suggested: ['Summer plan'],
    });
  });

  it("runs a message sent mid-run as a run of its own, with the host's context, and reports both", async () => {
    const resourceId = 'u-work-mid-run';
    const { mainThreadId, controller, storage, memory } = await setup(resourceId);
    const contexts: Array<{ untrusted: boolean; marked: unknown }> = [];
    const workThreads = createWorkThreads({
      getController: async () => controller,
      storage,
      runContext: (context, thread) => {
        context.set('host.untrusted', thread.untrusted === true);
        contexts.push({ untrusted: thread.untrusted === true, marked: context.get('caller') });
      },
      // Words only from runs that never said "spring recipes" (a stand-in for untrusted text).
      reportsWords: ({ runMessages }) => !JSON.stringify(runMessages).includes('spring recipes'),
    });
    const caller = new (await import('@mastra/core/request-context')).RequestContext();
    caller.set('caller', 'main');
    const { threadId } = await workThreads.start({
      resourceId,
      parentThreadId: mainThreadId,
      title: 'Spring newsletter plan',
      brief: 'Plan the spring newsletter: three sections and a subject line.',
      requestContext: caller,
    });
    const sent = await workThreads.message({
      threadId,
      resourceId,
      text: 'From the main chat: Add a section on spring recipes.',
      requestContext: caller,
    });
    expect(sent.running).toBe(true);

    const reports = async () =>
      (await memory.listMessages({ threadId: mainThreadId })).messages.filter(
        (m) => (m.content.metadata as Record<string, unknown> | undefined)?.[WORK_THREAD_KEY],
      );
    await waitFor(async () => (await reports()).length === 2);
    const texts = (await reports()).map((m) => m.content.content ?? '');
    expect(texts[0]).toContain('Subject: Spring is here.');
    // Each report is judged by its own run: the second carries no words.
    expect(texts[1]).toMatch(/is done\.$/);
    expect(texts[1]).not.toContain('Added a fourth section');
    expect(contexts).toEqual([
      { untrusted: false, marked: 'main' },
      { untrusted: false, marked: 'main' },
    ]);
  });
});
