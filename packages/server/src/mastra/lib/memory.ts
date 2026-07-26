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
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { env } from '../../lib/env';

// ONE shared libSQL store instance for the whole server — the Mastra instance,
// every agent's Memory, AND the harness AgentController all use THIS so
// threads/messages land in a single DB. Passing it explicitly (rather than
// letting Memory fall back to its own relative `file:mastra.db`) is what keeps
// the agent's writes and the harness's `session.thread.list()` reads in the same
// file — otherwise they split (the agent writes to src/mastra/public/mastra.db
// under `mastra dev` while the harness reads the absolutized ./mastra.db).
let sharedStore: LibSQLStore | null = null;
export function getSharedStore(): LibSQLStore {
  if (!sharedStore) {
    sharedStore = new LibSQLStore({
      id: 'mastra-storage',
      url: env.TURSO_DATABASE_URL,
      ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
    });
  }
  return sharedStore;
}

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
    // Explicit shared store (NOT Memory's relative-path default) so the agent's
    // threads/messages persist to the same DB the harness reads. See getSharedStore.
    storage: getSharedStore(),
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
      // Observational Memory (harness showcase) — a background Observer distills durable
      // facts from the conversation and a Reflector compresses them, so the agent recalls
      // context ACROSS conversations (scope: 'resource'), not just within a thread. It runs
      // its own model (gated on env.CHAT_MODEL rather than the default Google model, so a
      // single provider key suffices). This adds background model calls, so it's toggleable
      // via env.OBSERVATIONAL_MEMORY (default on) — tests set it off for deterministic,
      // zero-spend runs (the Observer/Reflector need real structured output AIMock can't
      // stand in for). Emits the om_* events the harness forwards (Memory-panel UI: 698.x).
      ...(env.OBSERVATIONAL_MEMORY
        ? {
            observationalMemory: {
              model: env.CHAT_MODEL,
              scope: 'resource' as const,
              observation: {
                // Default is 30,000 tokens of unobserved messages before the Observer
                // runs — far more than a demo conversation reaches, so observations would
                // never visibly fire. Lowered so the OM loop triggers within a few
                // exchanges (the whole point of the showcase). Raise toward the default in
                // production to control Observer-model cost.
                messageTokens: 3000,
              },
            },
          }
        : {}),
    },
  });
}
