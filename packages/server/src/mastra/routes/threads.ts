// ──────────────────────────────────────────────────────────────────────────
// Agent Controller conversation history (the sidebar). The controller persists its
// threads/messages to its own store (see lib/agent-controller.ts), so these read the
// live Session's thread domain directly — `session.thread.list()` /
// `listMessages()` / `delete()` — no Memory involved. Title/search fall back
// to the first user message (chat-app convention) until AI titling lands (698.11).
// ──────────────────────────────────────────────────────────────────────────

import { registerApiRoute } from '@mastra/core/server';
import { messageText, searchSnippet, threadTitle, toUIMessage } from '../lib/thread-utils';
import type { ChatServerDeps } from './types';

export const createThreadRoutes = (deps: ChatServerDeps) => [
  // List the controller's conversations (newest first) with a display title.
  registerApiRoute('/agent-controller/threads', {
    method: 'GET',
    handler: async (c) => {
      const session = await deps.getSession();
      const threads = await session.thread.list();
      const items: Array<{
        id: string;
        title: string;
        archived: boolean;
        createdAt: string;
        updatedAt: string;
      }> = [];
      for (const t of threads) {
        const explicitTitle = typeof t.title === 'string' ? t.title.trim() : '';
        // The user's turn is persisted with role "signal" (a data-user-message
        // part), which `firstUserMessages` (role "user") misses — scan the opening
        // messages for the first non-assistant text to use as the display title.
        let first = '';
        if (!explicitTitle) {
          const msgs = await session.thread.listMessages({ threadId: t.id, limit: 8 });
          for (const m of msgs) {
            if ((m as { role?: string }).role !== 'assistant') {
              const text = messageText(m);
              if (text) {
                first = text;
                break;
              }
            }
          }
        }
        // Skip phantom empty threads (bound but never sent a message).
        if (!explicitTitle && !first) {
          continue;
        }
        items.push({
          id: t.id,
          title: threadTitle(t, first),
          archived: Boolean((t.metadata as Record<string, unknown> | undefined)?.archived),
          createdAt: new Date(t.createdAt).toISOString(),
          updatedAt: new Date(t.updatedAt).toISOString(),
        });
      }
      items.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      return c.json({ threads: items });
    },
  }),

  // Semantic search over the controller's conversations — matches message BODIES,
  // not just titles. Controller messages are already embedded into the vector
  // index by `createDefaultMemory`'s semanticRecall, so we embed the query and
  // query that same index. The user's turn is stored role="signal" but its text
  // is embedded with `content`, so it matches too.
  //
  // `deps.search` is optional: a consumer with no vector index gets an empty
  // result rather than a 500, so the sidebar still works.
  registerApiRoute('/agent-controller/threads/search', {
    method: 'GET',
    handler: async (c) => {
      const q = (c.req.query('q') ?? '').trim();
      if (q.length < 2 || !deps.search) {
        return c.json({ threads: [] });
      }
      const embedding = await deps.search.embed(q);
      const hits = await deps.search.query(embedding, 24);
      // Best (highest-ranked) hit per thread → snippet from the matched message.
      const seen = new Map<string, { snippet: string; score: number }>();
      for (const h of hits) {
        // biome-ignore lint/suspicious/noExplicitAny: vector metadata
        const md = (h.metadata ?? {}) as any;
        const tid = md.thread_id as string | undefined;
        if (tid && !seen.has(tid)) {
          seen.set(tid, {
            snippet: searchSnippet(String(md.content ?? ''), q),
            score: h.score ?? 0,
          });
        }
      }
      if (seen.size === 0) {
        return c.json({ threads: [] });
      }
      // Resolve display titles for the matched threads from the controller's own
      // thread list (explicit title → first non-assistant message). Only threads
      // that still exist are returned.
      const session = await deps.getSession();
      const threads = await session.thread.list();
      const byId = new Map(threads.map((t) => [t.id, t]));
      const matchedIds = [...seen.keys()].filter((id) => byId.has(id));
      const results = await Promise.all(
        matchedIds.map(async (id) => {
          const t = byId.get(id);
          let first = '';
          const explicit = typeof t?.title === 'string' ? t.title.trim() : '';
          if (!explicit) {
            // No stored title yet — derive one from the first non-assistant turn
            // (the user's role="signal" message), same as /agent-controller/threads.
            const msgs = await session.thread.listMessages({ threadId: id, limit: 8 });
            for (const m of msgs) {
              if ((m as { role?: string }).role !== 'assistant') {
                const text = messageText(m);
                if (text) {
                  first = text;
                  break;
                }
              }
            }
          }
          return {
            id,
            title: threadTitle(t, first),
            snippet: seen.get(id)?.snippet ?? '',
            score: seen.get(id)?.score ?? 0,
          };
        }),
      );
      results.sort((a, b) => b.score - a.score);
      return c.json({ threads: results });
    },
  }),

  // Load one controller conversation's messages as v6 UIMessages (text-only
  // restore — richer parts rehydrate on the live stream when the conversation
  // continues).
  registerApiRoute('/agent-controller/threads/:id/messages', {
    method: 'GET',
    handler: async (c) => {
      const session = await deps.getSession();
      const messages = await session.thread.listMessages({ threadId: c.req.param('id') });
      return c.json({ messages: messages.map(toUIMessage) });
    },
  }),

  // Delete a controller conversation (hard delete; clears the binding if active).
  registerApiRoute('/agent-controller/threads/:id', {
    method: 'DELETE',
    handler: async (c) => {
      const session = await deps.getSession();
      await session.thread.delete({ threadId: c.req.param('id') });
      return c.json({ ok: true });
    },
  }),

  // Archive/unarchive or rename a controller conversation. The AgentController's
  // public `session.thread.rename`/metadata are ACTIVE-thread scoped, but the
  // controller's threads now live in the shared store, so the Memory can update any
  // thread by id (same table). The Mastra instance comes off the Hono context
  // (`CustomRouteVariables`) rather than an import — importing it from index.ts
  // would be circular, since index.ts imports these routes.
  registerApiRoute('/agent-controller/threads/:id', {
    method: 'PATCH',
    handler: async (c) => {
      const id = c.req.param('id');
      const body = await c.req.json<{ archived?: boolean; title?: string }>();
      const memory = await c.get('mastra').getAgent(deps.agentId).getMemory();
      if (!memory) {
        return c.json({ error: 'memory not configured' }, 500);
      }
      const thread = await memory.getThreadById({ threadId: id });
      if (!thread) {
        return c.json({ error: 'not found' }, 404);
      }
      const metadata = { ...(thread.metadata as Record<string, unknown> | undefined) };
      if (typeof body.archived === 'boolean') {
        metadata.archived = body.archived;
      }
      await memory.updateThread({
        id,
        title:
          typeof body.title === 'string' && body.title.trim()
            ? body.title.trim()
            : (thread.title ?? ''),
        metadata,
      });
      return c.json({ ok: true });
    },
  }),
];
