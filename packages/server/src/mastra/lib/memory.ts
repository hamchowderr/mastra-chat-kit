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
 *                          no API key) + **PgVector**. Embeds messages so the agent
 *                          can recall relevant earlier turns — and so the chat-history
 *                          sidebar can do semantic search across a user's chats
 *                          (`memory.recall({ threadId: [...], vectorSearchString })`).
 *   - Auto titles        — ON. Mastra names each new thread (a fast model) → the
 *                          title shown in the sidebar (`mastra_threads.title`).
 *
 * Storage: this factory passes no `storage`, so Memory inherits the Mastra
 * instance's PostgresStore. The `vector` store IS passed (PgVector on the same
 * Postgres) — requires the `vector` extension (Supabase has it; for local dev use
 * a pgvector image). resourceId is REQUIRED for resource-scoped persistence:
 *
 *   await agent.stream(msgs, { memory: { thread: threadId, resource: userId } });
 */

import { fastembed } from '@mastra/fastembed';
import { Memory } from '@mastra/memory';
import { PgVector } from '@mastra/pg';
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

// One shared PgVector across all agents (same Postgres as the main store).
let sharedVector: PgVector | null = null;
export function getSharedVector(): PgVector {
  if (!sharedVector) {
    sharedVector = new PgVector({ id: 'mastra-vector', connectionString: env.SUPABASE_DB_URL });
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
