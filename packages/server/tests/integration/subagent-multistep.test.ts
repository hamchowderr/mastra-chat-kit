import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentController } from '@mastra/core/agent-controller';
import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A non-forked subagent can take more than one step (patches/@mastra__core@1.69.0.patch).
 *
 * Unpatched, core copies the parent run's whole request context into a non-forked
 * subagent, including the parent's `MastraMemory` thread. The subagent has no memory, so
 * on its SECOND step the browser-context state signal finds a thread but no memory and
 * throws `computeStateSignal requires Mastra memory…`: the subagent dies after its first
 * tool call. The patch drops the parent memory context for non-forked runs, and makes the
 * runner skip a thread-less run before demanding memory.
 *
 * Only reproduces in the DEV shape — the chat agent carrying the shared browser-bearing
 * workspace — so NODE_ENV is stubbed to development before the sources load.
 * subagent-browser-repro.test.ts cannot catch it: its subagent answers in one step.
 */

let root: string;
let controller: AgentController;
let mastra: Mastra;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'chat-kit-multistep-'));
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('WORKSPACE_ROOT', root);
  const { chatAgent } = await import('../../src/mastra/agents/chat');
  const { createChatAgentController } = await import('../../src/mastra/lib/agent-controller');
  const { getChatWorkspace } = await import('../../src/mastra/lib/workspace');
  controller = createChatAgentController({
    storage: new InMemoryStore(),
    resourceId: 'u-multistep',
    workspace: getChatWorkspace(),
  });
  mastra = new Mastra({
    agents: { chat: chatAgent },
    agentControllers: { chat: controller },
    storage: new InMemoryStore(),
  });
  await controller.init();
}, 60_000);

afterAll(async () => {
  await controller?.destroy();
  await mastra?.shutdown();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('non-forked subagent, several steps (live wiring)', () => {
  it('lists the workspace, then reports — no state-signal throw', async () => {
    const session = await controller.createSession({ resourceId: 'u-multistep' });
    // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide
    const events: any[] = [];
    const unsubscribe = session.subscribe((event) => {
      events.push(event);
      if (event.type === 'tool_approval_required') {
        session.respondToToolApproval({ decision: 'approve' });
      }
    });
    await session.thread.create();
    await session.sendMessage({
      content: 'Guard 698.32: have the code subagent list the workspace',
    });
    unsubscribe();

    const blob = JSON.stringify(events);
    expect(blob).not.toContain('requires Mastra memory');
    // Step 1 really ran a tool, so step 2 really ran the per-step state signal.
    const subTools = events.filter((e) => e.type === 'subagent_tool_end');
    expect(subTools.map((e) => e.subToolName)).toContain('mastra_workspace_list_files');
    expect(subTools.every((e) => e.isError !== true)).toBe(true);
    const end = events.find((e) => e.type === 'subagent_end');
    expect(end?.isError).not.toBe(true);
    expect(end?.result).toContain('Listed the workspace.');
  });
});
