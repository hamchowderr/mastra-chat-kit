import type { AgentController } from '@mastra/core/agent-controller';
import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatAgent } from '../../src/mastra/agents/chat';
import { createChatAgentController } from '../../src/mastra/lib/agent-controller';
import { syncChatKnowledge } from '../../src/mastra/lib/chat-knowledge';

/**
 * The research specialist searches Knowledge. It is a fresh agent with no memory, so its
 * knowledge_search holds no thread or resource scope of its own: it works only because
 * Core passes the parent run's org scope (the chat agent's `scopes`) down to nested runs
 * on the request context. Without it the tool answers "Knowledge tools need run scopes".
 */

let controller: AgentController;
let mastra: Mastra;

beforeAll(async () => {
  await syncChatKnowledge();
  controller = createChatAgentController({
    storage: new InMemoryStore(),
    resourceId: 'u-research-kb',
    browser: null,
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
});

describe('research subagent + Knowledge (AIMock)', () => {
  it('finds the synced Tool approvals page with the parent run’s org scope', async () => {
    const session = await controller.createSession({ resourceId: 'u-research-kb' });
    // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide
    const events: any[] = [];
    const unsubscribe = session.subscribe((event) => {
      events.push(event);
      if (event.type === 'tool_approval_required') {
        session.respondToToolApproval({ decision: 'approve', toolCallId: event.toolCallId });
      }
    });
    await session.thread.create();
    await session.sendMessage({
      content: 'Have the research subagent look up tool approvals in the knowledge base',
    });
    unsubscribe();

    const search = events.find(
      (e) => e.type === 'subagent_tool_end' && e.subToolName === 'knowledge_search',
    );
    expect(search?.isError).not.toBe(true);
    expect(JSON.stringify(search?.subToolResult)).toContain('org:chat-kit#guides/tool-approvals');
    const end = events.find((e) => e.type === 'subagent_end');
    expect(end?.result).toContain('Tool approvals');
  });
});
