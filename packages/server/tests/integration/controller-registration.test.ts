import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { describe, expect, it } from 'vitest';
import { chatAgent } from '../../src/mastra/agents/chat';
import { createChatAgentController } from '../../src/mastra/lib/agent-controller';

// Its own file on purpose: init() re-homes the module-level chatAgent, and vitest
// isolates module state per file.
describe('AgentController registration (mastra-chat-kit-9m3)', () => {
  it('keeps chatAgent on the app Mastra after the controller initializes', async () => {
    const controller = createChatAgentController({ storage: new InMemoryStore(), browser: null });
    const mastra = new Mastra({
      agents: { chat: chatAgent },
      agentControllers: { chat: controller },
      storage: new InMemoryStore(),
    });

    await controller.init();

    // Unregistered, init() builds an internal Mastra with no observability and moves
    // chatAgent onto it, so no run on any path creates a span.
    expect(chatAgent.getMastraInstance()).toBe(mastra);
  });
});
