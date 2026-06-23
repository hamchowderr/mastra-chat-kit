import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';
import { chatAgent } from '../../src/mastra/agents/chat';

/**
 * Tier-1 in-memory Mastra. Registering the agent here gives its Memory a
 * zero-dependency storage backend, so Agent-mode tests run with no Postgres,
 * no Docker, no external services — fully deterministic alongside AIMock.
 */
export const testMastra = new Mastra({
  agents: { chat: chatAgent },
  storage: new InMemoryStore(),
});

export const testChatAgent = testMastra.getAgent('chat');
