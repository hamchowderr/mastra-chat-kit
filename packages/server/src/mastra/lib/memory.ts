/**
 * # Shared Memory Baseline (persistence + recall + titles)
 *
 * Use this factory instead of `new Memory()` so every agent shares one memory
 * policy:
 *
 *   import { createDefaultMemory } from '../lib/memory';
 *   export const myAgent = new Agent({ ..., memory: createDefaultMemory() });
 *
 * ## What's configured
 *
 *   - Message history   — ON (Mastra default). Recent turns are prepended.
 *   - Working memory     — ON, resource-scoped Markdown scratchpad (user profile +
 *                          session state), persists across all of a user's threads.
 *   - Semantic recall    — ON, via **fastembed** (local ONNX `bge-small`, 384-dim,
 *                          no API key) + **LibSQLVector**. Embeds messages so the agent
 *                          can recall relevant earlier turns — and so the chat-history
 *                          sidebar can do semantic search across a user's chats
 *                          (`memory.recall({ threadId: [...], vectorSearchString })`).
 *   - Auto titles        — ON. Mastra names each new thread (a fast model) → the
 *                          title shown in the sidebar (`mastra_threads.title`).
 *
 * Storage: this factory passes no `storage`, so Memory inherits the Mastra
 * instance's LibSQLStore. The `vector` store IS passed (LibSQLVector on the same
 * libSQL/Turso DB) — libSQL has native vector search, so there's no extension or
 * extra service to run. resourceId is REQUIRED for resource-scoped persistence:
 *
 *   await agent.stream(msgs, { memory: { thread: threadId, resource: userId } });
 */

import { fastembed } from '@mastra/fastembed';
import { LibSQLVector } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { env } from '../../lib/env';

/** Default working-memory scratchpad. Short, focused labels per Mastra's guidance. */
export const DEFAULT_WORKING_MEMORY_TEMPLATE = `# User Profile

## Identity
- Name:
- Role / Company:

## Preferences
- Communication style: [e.g., concise, detailed]
- Constraints / things to avoid:

## Session State
- Current goal:
- Open items:
`;

// One shared libSQL vector index across all agents (same DB as the main store).
let sharedVector: LibSQLVector | null = null;
export function getSharedVector(): LibSQLVector {
  if (!sharedVector) {
    sharedVector = new LibSQLVector({
      id: 'mastra-vector',
      url: env.TURSO_DATABASE_URL,
      ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
    });
  }
  return sharedVector;
}

/**
 * The PgVector index name Mastra uses for message embeddings with the fastembed
 * `bge-small` model (384 dims). The chat-search route queries this directly.
 */
export const MESSAGE_VECTOR_INDEX = 'memory_messages_384';

/**
 * Build a Memory instance with the shared baseline. Each agent gets its own
 * instance. Override `template` to track agent-specific fields.
 */
export function createDefaultMemory(template: string = DEFAULT_WORKING_MEMORY_TEMPLATE): Memory {
  return new Memory({
    embedder: fastembed,
    vector: getSharedVector(),
    options: {
      workingMemory: {
        enabled: true,
        scope: 'resource',
        template,
      },
      // Recall relevant earlier turns within the conversation; also powers the
      // sidebar's semantic chat search (recall with a vectorSearchString).
      semanticRecall: {
        topK: 3,
        messageRange: 2,
      },
      // Name each new thread so the sidebar has a human-readable title.
      generateTitle: {
        model: 'anthropic/claude-haiku-4-5',
        instructions:
          'Generate a concise 3-6 word title summarizing the user\'s request in this conversation. Output ONLY the plain title text — no markdown, no quotes, no "Title:" label.',
      },
    },
  });
}
