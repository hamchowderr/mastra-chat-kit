import { InMemoryStore } from '@mastra/core/storage';
import { describe, expect, it } from 'vitest';
import { createBrowser, createChatHarness } from '../../src/mastra/lib/harness';

/**
 * Agent Harness mode end-to-end through AIMock — deterministic, zero spend.
 * Proves the Harness wraps the same chatAgent and emits HarnessEvents we can
 * stream to the UI (message updates, run lifecycle). Mirrors the Single Agent
 * integration test but over the Harness `subscribe()` surface.
 */
describe('chat agent — Agent Harness mode (AIMock)', () => {
  it('streams harness events for a greeting', async () => {
    const controller = createChatHarness({
      storage: new InMemoryStore(),
      resourceId: 'u-harness-greeting',
    });
    await controller.init();
    const session = await controller.createSession({ resourceId: 'u-harness-greeting' });

    // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide; we assert on .type
    const events: any[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));

    await session.thread.create({ title: 'greeting' });
    await session.sendMessage({ content: 'Hello' });

    unsubscribe();
    await controller.destroy();

    const types = new Set(events.map((e) => e.type));
    // The harness must surface assistant message activity...
    expect(types.has('message_update')).toBe(true);
    // ...and the greeting fixture's text (contains "help") must appear.
    expect(JSON.stringify(events).toLowerCase()).toContain('help');
  });

  // The Harness gates tool calls behind an approval (HITL) by default: getWeather
  // emits `tool_approval_required` and the run SUSPENDS until a decision. This
  // proves the full round-trip — model requests the tool, we approve, the tool
  // executes, and the run completes — over the real Harness approval surface.
  it('gates getWeather behind approval, then completes when approved', async () => {
    const controller = createChatHarness({
      storage: new InMemoryStore(),
      resourceId: 'u-harness-weather',
    });
    await controller.init();
    const session = await controller.createSession({ resourceId: 'u-harness-weather' });

    // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide; we assert on .type
    const events: any[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));

    await session.thread.create({ title: 'weather' });

    // sendMessage stays pending at the approval gate — do NOT await it yet.
    const done = session.sendMessage({ content: "What's the weather in Los Angeles?" });

    // Wait for the gate to arm.
    await waitFor(() => events.some((e) => e.type === 'tool_approval_required'), 15_000);
    expect(events.some((e) => e.type === 'tool_approval_required')).toBe(true);

    // Approve → the run resumes, the tool executes, and sendMessage resolves.
    session.respondToToolApproval({ decision: 'approve' });
    await done;

    unsubscribe();
    await controller.destroy();

    const blob = JSON.stringify(events);
    expect(blob).toContain('getWeather');
    // "Los Angeles" appears in the executed tool's result regardless of final text.
    expect(blob.toLowerCase()).toContain('los angeles');
  });

  // ONE agent, native subagents: the chat agent delegates to the `code` subagent via
  // the controller's built-in `subagent` tool. This proves the subagent_* event path
  // fires end-to-end (the fixture makes the model call `subagent`; the spawned code
  // subagent responds via its own fixture). Auto-approves any gated tool as it arms.
  it('delegates to the code subagent and emits subagent_* events', async () => {
    const controller = createChatHarness({
      storage: new InMemoryStore(),
      resourceId: 'u-harness-subagent',
      browser: null,
    });
    await controller.init();
    const session = await controller.createSession({ resourceId: 'u-harness-subagent' });

    // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide
    const events: any[] = [];
    const unsubscribe = session.subscribe((event) => {
      events.push(event);
      // The subagent tool (and any nested tool) is approval-gated by default — approve
      // as gates arm so the delegation runs to completion.
      if (event.type === 'tool_approval_required') {
        session.respondToToolApproval({ decision: 'approve' });
      }
    });

    await session.thread.create({ title: 'subagent' });
    await session.sendMessage({ content: 'Use the code subagent to create hello.txt' });

    unsubscribe();
    await controller.destroy();

    const types = new Set(events.map((e) => e.type));
    // The subagent must have spawned and finished (the six subagent_* events fire).
    expect(types.has('subagent_start')).toBe(true);
    expect(types.has('subagent_end')).toBe(true);
    const blob = JSON.stringify(events);
    // ...as the `code` type...
    expect(blob).toContain('"agentType":"code"');
    // ...and it must run to completion WITHOUT the non-forked state-signal failure.
    // (code.ts uses forked:true; a non-forked run throws "requires Mastra memory…".)
    expect(blob).not.toContain('requires Mastra memory');
  });

  // Modes: the controller exposes the Chat + Plan catalog, and switching emits
  // `mode_changed`. This is exactly what the /harness/modes + /harness/mode routes
  // call (controller.listModes / session.mode.switch).
  it('exposes Chat + Plan modes and switches, emitting mode_changed', async () => {
    const controller = createChatHarness({
      storage: new InMemoryStore(),
      resourceId: 'u-harness-modes',
      browser: null,
    });
    await controller.init();

    const ids = controller.listModes().map((m) => m.id);
    expect(ids).toContain('chat');
    expect(ids).toContain('plan');

    const session = await controller.createSession({ resourceId: 'u-harness-modes' });
    // biome-ignore lint/suspicious/noExplicitAny: wide event union
    const events: any[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));

    await session.thread.create({ title: 'modes' });
    expect(session.mode.get()).toBe('chat'); // defaultModeId
    await session.mode.switch({ modeId: 'plan' });

    unsubscribe();
    await controller.destroy();

    expect(session.mode.get()).toBe('plan');
    expect(events.some((e) => e.type === 'mode_changed' && e.modeId === 'plan')).toBe(true);
  });

  // Goals: the agent's native objective mechanism (the /harness/goal routes drive exactly
  // this). Set an objective on the active thread via the mode-backing agent, read it back
  // from the durable thread-state, then clear it. Uses `controller.getCurrentAgent` — the
  // agent with the controller's storage propagated — so the objective it writes is the one
  // the in-loop goal step reads. Deterministic (no judge/LLM run), zero spend.
  it('sets, reads back, and clears an objective on the active thread', async () => {
    const controller = createChatHarness({
      storage: new InMemoryStore(),
      resourceId: 'u-harness-goals',
      browser: null,
    });
    await controller.init();
    const session = await controller.createSession({ resourceId: 'u-harness-goals' });
    await session.thread.create({ title: 'goals' });
    const threadId = session.thread.requireId();

    const agent = controller.getCurrentAgent(session);
    const record = await agent.setObjective('Create hello.txt and prove it exists.', {
      threadId,
      resourceId: 'u-harness-goals',
      maxRuns: 3,
    });
    // The objective persisted with our budget and an active status.
    expect(record?.objective).toContain('hello.txt');
    expect(record?.maxRuns).toBe(3);
    expect(record?.status).toBe('active');

    // Durable read-back through the same store the goal loop would read from.
    const read = await agent.getObjective({ threadId });
    expect(read?.objective).toBe(record?.objective);

    // Clearing removes it (the agent stops goal-driven looping).
    await agent.clearObjective({ threadId });
    expect(await agent.getObjective({ threadId })).toBeFalsy();

    await controller.destroy();
  });

  // Agent-driven ask_user (698.30): when a request is ambiguous the agent calls the
  // built-in `ask_user` tool, which SUSPENDS the run (emitting `tool_suspended` with the
  // question in its payload) until the user answers. This proves the full round-trip the
  // /harness/answer route drives: the run parks on the question, we answer via
  // `respondToToolSuspension`, and the suspended tool resumes with the answer.
  it('suspends on ask_user for an ambiguous request, then resumes when answered', async () => {
    const controller = createChatHarness({
      storage: new InMemoryStore(),
      resourceId: 'u-harness-askuser',
      browser: null,
    });
    await controller.init();
    const session = await controller.createSession({ resourceId: 'u-harness-askuser' });

    // biome-ignore lint/suspicious/noExplicitAny: wide event union
    const events: any[] = [];
    const unsubscribe = session.subscribe((event) => {
      events.push(event);
      // Approve any OTHER gated tool; ask_user is granted below so it never gates.
      if (event.type === 'tool_approval_required' && event.toolName !== 'ask_user') {
        session.respondToToolApproval({ decision: 'approve' });
      }
    });

    // Mirror the web path (getChatSession): a clarifying question isn't approval-gated —
    // the answer prompt IS the interaction — so ask_user is auto-allowed.
    session.grantTool('ask_user');

    await session.thread.create({ title: 'askuser' });

    // sendMessage stays pending while the run is SUSPENDED on ask_user — don't await yet.
    const done = session.sendMessage({ content: 'Deploy the app for me.' });

    // The run suspends on ask_user, carrying the question in the suspend payload.
    await waitFor(() => events.some((e) => e.type === 'tool_suspended'), 20_000);
    const suspend = events.find((e) => e.type === 'tool_suspended');
    expect(suspend.toolName).toBe('ask_user');
    expect((suspend.suspendPayload as { question?: string }).question).toContain('environment');
    // The grant worked: ask_user reached suspend WITHOUT a redundant approval gate.
    expect(
      events.some((e) => e.type === 'tool_approval_required' && e.toolName === 'ask_user'),
    ).toBe(false);

    // Answer → the suspended tool resumes with the answer (the /harness/answer path).
    // The mock continuation after resume may not stream cleanly (AIMock-only), so tolerate
    // a hang/error on the run's completion — the resume itself is what we assert.
    const resumed = session.respondToToolSuspension({ resumeData: 'production' });
    await resumed.catch(() => {});
    await done.catch(() => {});

    unsubscribe();
    await controller.destroy();

    // The ask_user tool fired and (post-resume) resolved on this run.
    const blob = JSON.stringify(events);
    expect(blob).toContain('ask_user');
    expect(events.some((e) => e.type === 'tool_end')).toBe(true);
  });

  // Agent-driven goals: goals aren't set by a UI control — the agent recognizes a standing
  // objective and calls its OWN `setGoal` tool, which writes the objective to thread-state.
  // The fixture makes the model call setGoal; we assert the objective actually persisted on
  // the thread (proving the tool's execute reaches setObjective with the run's thread id).
  it('sets its own objective via the setGoal tool when it detects a standing goal', async () => {
    const controller = createChatHarness({
      storage: new InMemoryStore(),
      resourceId: 'u-harness-setgoal',
      browser: null,
    });
    await controller.init();
    const session = await controller.createSession({ resourceId: 'u-harness-setgoal' });

    // biome-ignore lint/suspicious/noExplicitAny: wide event union
    const events: any[] = [];
    const unsubscribe = session.subscribe((event) => {
      events.push(event);
      if (event.type === 'tool_approval_required') {
        session.respondToToolApproval({ decision: 'approve' });
      }
    });

    await session.thread.create({ title: 'setgoal' });
    const threadId = session.thread.requireId();
    try {
      await session.sendMessage({
        content: 'Your goal is to greet me warmly. Keep going until done.',
      });
    } catch {
      // The goal judge runs on the mock catch-all and may error — irrelevant here; the
      // tool wrote the objective before the judge ran, which is what we assert.
    }
    unsubscribe();

    // The setGoal tool fired and persisted a durable objective on the active thread.
    const objective = await controller.getCurrentAgent(session).getObjective({ threadId });
    expect(objective?.objective).toContain('Greet');
    expect(JSON.stringify(events)).toContain('setGoal');

    await controller.destroy();
  });
});

/**
 * The workspace carries a browser (`@mastra/browser-viewer`) so the agent gets
 * browser tools alongside filesystem + shell. Chrome must launch LAZILY — the
 * server (and this test suite, and AIMock/CI) must boot without spawning a
 * browser. This locks that: constructing + initializing the real production
 * harness config leaves the browser un-launched until a tool actually drives it.
 */
describe('harness workspace browser (lazy)', () => {
  it('attaches a browser but does not launch Chrome at construct/init', async () => {
    const viewer = createBrowser();
    expect(viewer.isBrowserRunning()).toBe(false);

    const controller = createChatHarness({
      storage: new InMemoryStore(),
      resourceId: 'u-harness-browser',
      browser: viewer,
    });
    await controller.init();
    // Boot-critical invariant: init() must NOT have launched the browser.
    expect(viewer.isBrowserRunning()).toBe(false);

    await controller.destroy();
    expect(viewer.isBrowserRunning()).toBe(false);
  });
});

/** Poll until `pred()` is true or `timeoutMs` elapses. */
async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition not met within timeout');
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
