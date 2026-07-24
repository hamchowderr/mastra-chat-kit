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
