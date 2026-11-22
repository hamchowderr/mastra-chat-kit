/**
 * # The chat kit's Knowledge instance
 *
 * lib/knowledge.ts holds the env-free pieces; this file binds them to env: the shared
 * libSQL store and vector index (the same database as memory and threads), the local
 * fastembed embedder, the org scope every run holds, and the folder synced at boot.
 *
 * Pages live in `org:chat-kit`. A run holds that scope (the agent's `scopes`) as an
 * editor, plus its own `resource:<user>` and `thread:<id>` scopes from Memory, so a fact
 * one user asks the agent to keep for themselves goes in their resource scope.
 */
import { fastembed } from '@mastra/fastembed';
import { env } from '../../lib/env';
import { createChatKnowledge, folderSource, syncNotes } from './knowledge';
import { getSharedStore, getSharedVector } from './memory';

/** The org scope every chat run holds, where the synced pages live. */
export const KNOWLEDGE_SCOPE = 'org:chat-kit';

export const chatKnowledge = createChatKnowledge({
  storage: getSharedStore(),
  vector: getSharedVector(),
  embedder: fastembed,
});

/** Mirror KNOWLEDGE_DIR into the org scope. index.ts runs it at boot. */
export function syncChatKnowledge() {
  return syncNotes(chatKnowledge, KNOWLEDGE_SCOPE, folderSource(env.KNOWLEDGE_DIR));
}
