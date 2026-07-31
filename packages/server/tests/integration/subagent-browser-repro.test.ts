import { AgentController } from '@mastra/core/agent-controller';
import { InMemoryStore } from '@mastra/core/storage';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';
import { describe, expect, it } from 'vitest';
import { env } from '../../src/lib/env';
import { chatAgent } from '../../src/mastra/agents/chat';
import { codeSubagent } from '../../src/mastra/agents/code';
import { createDefaultMemory } from '../../src/mastra/lib/memory';
import { createBrowser, WORKSPACE_ROOT } from '../../src/mastra/lib/workspace';

/**
 * # 698.32 regression guard — non-forked specialist subagent works with a browser workspace
 *
 * `mastra-chat-kit-698.32` tracked a bug where a NON-forked (`forked: false`) subagent
 * running under a controller whose workspace carried a browser hard-threw
 * `[Processor:browser-context] computeStateSignal requires Mastra memory with an active
 * resourceId and threadId` — because the controller runs a non-forked subagent statelessly
 * (`threadId: null`, `resourceId: ""`, no memory) yet built it with the browser-bearing
 * workspace, whose `browser-context` state-signal processor threw instead of skipping.
 *
 * On the CURRENT `@mastra/core` that no longer reproduces (verified with the browser both
 * unlaunched AND launched): a non-forked specialist subagent runs to completion. This test
 * locks that in — if a future core upgrade regresses it, the first case flips from a clean
 * `subagent_end` to the state-signal throw and we catch it here.
 *
 * Uses AIMock (the shared subagent fixture makes the model call `subagent` agentType:'code').
 * Zero spend. Chrome is never launched here, so it stays fast/hermetic.
 */

/** Build a controller whose subagent forked-mode + workspace browser we control. */
function makeController(opts: { forked: boolean; withBrowser: boolean; resourceId: string }) {
  const browser = opts.withBrowser ? createBrowser() : undefined;
  return new AgentController({
    id: `repro-698-32-${opts.resourceId}`,
    defaultModeId: 'chat',
    agent: chatAgent,
    modes: [{ id: 'chat', name: 'Chat', description: 'repro', defaultModelId: env.CHAT_MODEL }],
    storage: new InMemoryStore(),
    resourceId: opts.resourceId,
    memory: createDefaultMemory(),
    subagents: [{ ...codeSubagent, forked: opts.forked }],
    workspace: new Workspace({
      id: 'repro-workspace',
      filesystem: new LocalFilesystem({ basePath: WORKSPACE_ROOT }),
      sandbox: new LocalSandbox({ workingDirectory: WORKSPACE_ROOT }),
      ...(browser ? { browser } : {}),
    }),
  });
}

/** Drive one subagent delegation and report whether it completed and whether it threw. */
async function runDelegation(opts: { forked: boolean; withBrowser: boolean; resourceId: string }) {
  const controller = makeController(opts);
  await controller.init();
  const session = await controller.createSession({ resourceId: opts.resourceId });
  // biome-ignore lint/suspicious/noExplicitAny: wide event union
  const events: any[] = [];
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
    if (event.type === 'tool_approval_required') {
      session.respondToToolApproval({ decision: 'approve' });
    }
  });

  let thrown = '';
  try {
    await session.thread.create({ title: 'repro' });
    await session.sendMessage({ content: 'Use the code subagent to create hello.txt' });
  } catch (err) {
    thrown = err instanceof Error ? err.message : String(err);
  } finally {
    unsubscribe();
    await controller.destroy();
  }

  const blob = `${JSON.stringify(events)} ${thrown}`;
  const end = events.find((e) => e.type === 'subagent_end');
  return {
    stateSignalThrew: blob.includes(
      'requires Mastra memory with an active resourceId and threadId',
    ),
    spawned: events.some((e) => e.type === 'subagent_start'),
    finishedOk: !!end && end.isError !== true,
  };
}

describe('698.32 — non-forked subagent + workspace browser (resolved)', () => {
  it('non-forked + browser: runs to completion, no state-signal throw', async () => {
    const r = await runDelegation({ forked: false, withBrowser: true, resourceId: 'u-repro-nf-b' });
    expect(r.spawned).toBe(true);
    expect(r.finishedOk).toBe(true);
    expect(r.stateSignalThrew).toBe(false); // the old 698.32 throw does NOT happen anymore
  });

  it('non-forked + browser:null: runs to completion', async () => {
    const r = await runDelegation({
      forked: false,
      withBrowser: false,
      resourceId: 'u-repro-nf-n',
    });
    expect(r.finishedOk).toBe(true);
    expect(r.stateSignalThrew).toBe(false);
  });

  it('forked + browser: runs to completion (self-clone worker)', async () => {
    const r = await runDelegation({ forked: true, withBrowser: true, resourceId: 'u-repro-f-b' });
    expect(r.finishedOk).toBe(true);
    expect(r.stateSignalThrew).toBe(false);
  });
});
