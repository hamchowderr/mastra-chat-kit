// 1. Env validation FIRST — crashes process if misconfigured
import { env } from '../lib/env';

// 2. AIMock provider switch — must run before any AI SDK client constructs
import { configureAIMock } from './lib/aimock';

configureAIMock();

import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { handleChatStream } from '@mastra/ai-sdk';
import { MastraJwtAuth } from '@mastra/auth';
// 3. Mastra imports — agents/tools constructed below now see the right base URLs
import { Mastra } from '@mastra/core/mastra';
import { RequestContext } from '@mastra/core/request-context';
import { registerApiRoute } from '@mastra/core/server';
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraEditor } from '@mastra/editor';
import { fastembed } from '@mastra/fastembed';
import { PinoLogger } from '@mastra/loggers';
import { MCPServer } from '@mastra/mcp';
import { MastraStorageExporter, Observability, SensitiveDataFilter } from '@mastra/observability';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  embed,
  generateText,
  streamText,
} from 'ai';
import { chatAgent } from './agents/chat';
import { doltConfigured, ensureDatabase } from './lib/dolt';
import {
  CHAT_RESOURCE_ID,
  getChatBrowser,
  getChatHarness,
  getChatSession,
  WORKSPACE_ROOT,
} from './lib/harness';
import { getImage } from './lib/image-store';
import {
  getSharedStore,
  getSharedVector,
  MESSAGE_VECTOR_INDEX,
  resolveTitleModelId,
} from './lib/memory';
import { messageText, searchSnippet, threadTitle, toUIMessage } from './lib/thread-utils';
import { readWorkspaceFile, readWorkspaceTree } from './lib/workspace-files';
import { doltTools } from './tools/dolt';

// Bootstrap the versioned Dolt database on first boot (no-op if Dolt isn't configured).
if (doltConfigured) {
  await ensureDatabase();
}

const mcpServer = new MCPServer({
  id: 'base-mcp',
  name: 'template-mastra-base',
  version: '0.1.0',
  description: 'MCP server exposing template-mastra-base agents + Dolt tools',
  // Dolt versioned-data tools exposed over MCP. To let an agent call them
  // directly, spread `...doltTools` into the agent's own `tools`.
  tools: { ...doltTools },
  agents: { chat: chatAgent },
});

// libSQL is the primary store (default/editor/memory domains + vectors). Local dev
// uses a file: DB — no server, no Docker; prod points TURSO_DATABASE_URL at a
// libsql:// Turso URL with TURSO_AUTH_TOKEN. libSQL has native vector search (no
// pgvector); only the observability OLAP domain uses DuckDB (see the composite
// store below). To switch the whole kit to Postgres instead, see docs/postgres.md.
// The ONE shared libSQL store — same instance the agents' Memory and the harness
// AgentController use, so threads/messages never split across DB files.
// libSQL serves the default/editor/memory domains + vectors; DuckDB serves ONLY
// the observability (OLAP) domain that Studio's Metrics/Logs query — libSQL can't
// back those views on core 1.52, so they'd read "not available". Memory + the
// harness use the same LibSQLStore (getSharedStore) directly, and the composite's
// `default` IS that instance, so threads/messages stay on one libSQL DB.
const storage = new MastraCompositeStore({
  id: 'composite-storage',
  default: getSharedStore(),
  domains: {
    observability: await new DuckDBStore().getStore('observability'),
  },
});

// Models the Single Agent route will accept from body.model (the composer's model
// picker). Keep in sync with web `MODELS` in components/chat/composer.tsx. The
// agent's own `model: env.CHAT_MODEL` is the fallback when none/invalid is sent.
const MODEL_ALLOWLIST = new Set([
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-opus-4-8',
  'anthropic/claude-haiku-4-5',
  'openai/gpt-4.1-mini',
  'openai/gpt-4o-mini',
  'openai/gpt-4.1-nano',
]);

// Single local user for thread/resource-scoped memory (this kit has no auth).
// Swap for the authenticated user id when adding auth.
const LOCAL_RESOURCE = 'local-user';

// Provider-native web search. NOTE: this can't stream through Mastra's agent loop
// in @mastra/core@1.45 — the loop has no provider-executed/server-hosted tool
// handling, so it stops at the web_search tool call and never forwards the result
// (mastra GH #14148/#10327, still open at latest). So web-search turns are handled
// by the AI SDK `streamText` directly (the layer Mastra is built on), streamed to
// the SAME v6 UIMessage transport + elements. Reversible: when Mastra fixes the
// loop, drop this branch and register the tool on the agent.
//
// Each provider has its OWN native web search; resolve the right model + tool from
// the model-router id so an OpenAI selection uses OpenAI search, Anthropic uses
// Anthropic's. OpenAI web search requires the Responses API (`openai.responses`).
function resolveWebSearch(routerId: string) {
  if (routerId.startsWith('openai/')) {
    const id = routerId.slice('openai/'.length);
    return { model: openai.responses(id), tools: { web_search: openai.tools.webSearch() } };
  }
  const id = routerId.replace(/^anthropic\//, '');
  return {
    model: anthropic(id),
    tools: { web_search: anthropic.tools.webSearch_20250305({ maxUses: 4 }) },
  };
}
// Resolve the AI SDK model instance for the manual thread-title route (the Single
// Agent path titles by hand — generateTitle doesn't fire through handleChatStream).
// Follows the configured title model (resolveTitleModelId), so an OpenAI-only setup
// titles with OpenAI instead of a hardcoded Anthropic model (698.11). Returns null
// for a provider this route can't construct — the caller then keeps the fallback title.
function resolveTitleModel() {
  const id = resolveTitleModelId();
  if (id.startsWith('openai/')) {
    return openai(id.slice('openai/'.length));
  }
  if (id.startsWith('anthropic/')) {
    return anthropic(id.slice('anthropic/'.length));
  }
  return null;
}

const WEB_SEARCH_SYSTEM =
  'You are a helpful, concise assistant with live web search. Use the web_search tool for anything that needs current or factual information, then answer and cite the sources. Use markdown.';
// On a persistent provider overload, fall back to this model (Haiku is the least
// likely to be capacity-constrained). Full model-router id.
const WEB_SEARCH_FALLBACK_MODEL = 'anthropic/claude-haiku-4-5';

/** Anthropic returns HTTP 529 `overloaded_error` when capacity is momentarily saturated. */
function isOverloaded(err: unknown): boolean {
  const text = `${(err as { message?: string })?.message ?? ''} ${(() => {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  })()}`;
  return /overloaded|\b529\b/i.test(text);
}

// JWT auth: when MASTRA_JWT_SECRET is set, gate all /api/* routes AND Studio
// behind a Bearer JWT signed with the shared secret. `/health` and `/api/auth/*`
// stay public (so healthchecks and the Studio login screen still work). Leave
// the secret unset for open local dev. Shared-secret only — no external provider.
// NB: name this `serverConfig`, not `server` — `mastra dev`'s generated entry
// declares its own top-level `server`, which collides in the bundler ("symbol
// 'server' has already been declared"). `mastra build` doesn't hit it.
const serverConfig = {
  apiRoutes: [

    // ──────────────────────────────────────────────────────────────────────
    // Chat-history sidebar — thread CRUD over Mastra Memory (single local user).
    // Titles fall back to the first user message (generateTitle doesn't fire via
    // handleChatStream). `archived` is a thread-metadata flag (soft, reversible).
    // ──────────────────────────────────────────────────────────────────────

    // List threads (newest first) with a display title + archived flag.
    registerApiRoute('/threads', {
      method: 'GET',
      handler: async (c) => {
        const memory = await mastra.getAgent('chat').getMemory();
        if (!memory) {
          return c.json({ threads: [] });
        }
        const { threads } = await memory.listThreads({
          filter: { resourceId: LOCAL_RESOURCE },
          perPage: false,
        });
        // Per-thread recall to derive first-message title fallbacks. libSQL's
        // getThreadById can't bind an array, so a batched `threadId: ids` throws
        // ("SQLite3 can only bind numbers, strings, bigints, buffers, and null")
        // and 500s the whole list — recall one id at a time. Best-effort: threads
        // carry a generated title regardless, so a recall miss just skips the
        // fallback rather than failing the request.
        const ids = threads.map((t) => t.id);
        const firstMsg = new Map<string, string>();
        for (const id of ids) {
          try {
            const { messages } = await memory.recall({
              threadId: id,
              resourceId: LOCAL_RESOURCE,
              perPage: false,
            });
            for (const m of messages) {
              // biome-ignore lint/suspicious/noExplicitAny: MastraDBMessage
              const mm = m as any;
              if (mm.role === 'user' && !firstMsg.has(id)) {
                firstMsg.set(id, messageText(mm));
                break;
              }
            }
          } catch {
            // best-effort — thread.title still applies
          }
        }
        const items = threads
          .map((t) => ({
            id: t.id,
            title: threadTitle(t, firstMsg.get(t.id)),
            archived: Boolean((t.metadata as Record<string, unknown> | undefined)?.archived),
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          }))
          .sort((a, b) => +new Date(b.updatedAt ?? 0) - +new Date(a.updatedAt ?? 0));
        return c.json({ threads: items });
      },
    }),

    // Load one thread's messages as v6 UIMessages (text-only restore).
    registerApiRoute('/threads/:id/messages', {
      method: 'GET',
      handler: async (c) => {
        const memory = await mastra.getAgent('chat').getMemory();
        if (!memory) {
          return c.json({ messages: [] });
        }
        const { messages } = await memory.recall({
          threadId: c.req.param('id'),
          resourceId: LOCAL_RESOURCE,
          perPage: false,
        });
        return c.json({ messages: messages.map(toUIMessage) });
      },
    }),

    // Semantic search across all the user's chats: embed the query with fastembed
    // and query the PgVector message-embedding index directly (the message text +
    // thread_id live in the vector metadata, so snippets are free).
    registerApiRoute('/threads/search', {
      method: 'GET',
      handler: async (c) => {
        const q = (c.req.query('q') ?? '').trim();
        if (q.length < 2) {
          return c.json({ threads: [] });
        }
        const { embedding } = await embed({ model: fastembed, value: q });
        const hits = await getSharedVector().query({
          indexName: MESSAGE_VECTOR_INDEX,
          queryVector: embedding,
          topK: 24,
          filter: { resource_id: LOCAL_RESOURCE },
        });
        // First (best) hit per thread → snippet from the matched message content.
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
        // Resolve titles for the matched threads (stored title → first user message).
        const memory = await mastra.getAgent('chat').getMemory();
        const ids = [...seen.keys()];
        const firstMsg = new Map<string, string>();
        const byId = new Map<string, unknown>();
        if (memory) {
          const { threads } = await memory.listThreads({
            filter: { resourceId: LOCAL_RESOURCE },
            perPage: false,
          });
          for (const t of threads) {
            byId.set(t.id, t);
          }
          const { messages } = await memory.recall({
            threadId: ids,
            resourceId: LOCAL_RESOURCE,
            perPage: false,
          });
          for (const m of messages) {
            // biome-ignore lint/suspicious/noExplicitAny: MastraDBMessage
            const mm = m as any;
            if (mm.role === 'user' && mm.threadId && !firstMsg.has(mm.threadId)) {
              firstMsg.set(mm.threadId, messageText(mm));
            }
          }
        }
        const results = ids
          .map((id) => ({
            id,
            title: threadTitle(byId.get(id), firstMsg.get(id)),
            snippet: seen.get(id)?.snippet ?? '',
            score: seen.get(id)?.score ?? 0,
          }))
          .sort((a, b) => b.score - a.score);
        return c.json({ threads: results });
      },
    }),

    // Delete a chat (hard delete).
    registerApiRoute('/threads/:id', {
      method: 'DELETE',
      handler: async (c) => {
        const memory = await mastra.getAgent('chat').getMemory();
        if (!memory) {
          return c.json({ error: 'memory not configured' }, 500);
        }
        await memory.deleteThread(c.req.param('id'));
        return c.json({ ok: true });
      },
    }),

    // Archive/unarchive or rename a chat (soft, reversible).
    registerApiRoute('/threads/:id', {
      method: 'PATCH',
      handler: async (c) => {
        const id = c.req.param('id');
        const body = await c.req.json<{ archived?: boolean; title?: string }>();
        const memory = await mastra.getAgent('chat').getMemory();
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

    // Generate (and persist) an AI title for a thread from its first turns. The
    // client calls this once after a new thread's first exchange, because Mastra's
    // built-in generateTitle doesn't fire through `handleChatStream`. Best-effort:
    // on any model error it leaves the existing first-message fallback in place.
    registerApiRoute('/threads/:id/title', {
      method: 'POST',
      handler: async (c) => {
        const id = c.req.param('id');
        const memory = await mastra.getAgent('chat').getMemory();
        if (!memory) {
          return c.json({ error: 'memory not configured' }, 500);
        }
        const thread = await memory.getThreadById({ threadId: id });
        if (!thread) {
          return c.json({ error: 'not found' }, 404);
        }
        const { messages } = await memory.recall({
          threadId: id,
          resourceId: LOCAL_RESOURCE,
          perPage: false,
        });
        // Compact transcript of the opening turns — enough for a good title.
        const transcript = messages
          .slice(0, 6)
          // biome-ignore lint/suspicious/noExplicitAny: MastraDBMessage
          .map((m) => `${(m as any).role}: ${messageText(m)}`)
          .filter((line) => line.length > 3)
          .join('\n')
          .slice(0, 2000);
        if (!transcript) {
          return c.json({ title: thread.title ?? '' });
        }
        // Provider-appropriate title model (falls back to the first-message title
        // when the configured provider isn't one this route can construct).
        const titleGenModel = resolveTitleModel();
        if (!titleGenModel) {
          return c.json({ title: thread.title ?? '' });
        }
        let title = '';
        try {
          const { text } = await generateText({
            model: titleGenModel,
            maxRetries: 3,
            system:
              'Generate a concise 3-6 word title summarizing the user\'s request in this conversation. Output ONLY the plain title text — no markdown, no quotes, no "Title:" label.',
            prompt: transcript,
          });
          title = text
            .trim()
            .replace(/^["']|["']$/g, '')
            .slice(0, 80);
        } catch {
          // Title generation is best-effort; keep the existing fallback title.
          return c.json({ title: thread.title ?? '' });
        }
        if (title) {
          await memory.updateThread({
            id,
            title,
            metadata: (thread.metadata as Record<string, unknown> | undefined) ?? {},
          });
        }
        return c.json({ title });
      },
    }),

    // ──────────────────────────────────────────────────────────────────────
    // Agent Harness conversation history (the sidebar). The harness persists its
    // threads/messages to its own store (see lib/harness.ts), so these read the
    // live Session's thread domain directly — `session.thread.list()` /
    // `listMessages()` / `delete()` — no Memory involved. Title/search fall back
    // to the first user message (chat-app convention) until AI titling lands (698.11).
    // ──────────────────────────────────────────────────────────────────────

    // List the harness's conversations (newest first) with a display title.
    registerApiRoute('/harness/threads', {
      method: 'GET',
      handler: async (c) => {
        const session = await getChatSession();
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

    // Semantic search over the harness's conversations — matches message BODIES,
    // not just titles. Harness messages are embedded into the SAME fastembed
    // vector index as the Single-Agent path (both drive `createDefaultMemory`'s
    // semanticRecall), just under the harness resourceId. So we embed the query
    // with fastembed (a LOCAL ONNX model — no API spend) and query the shared
    // index filtered to CHAT_RESOURCE_ID, exactly like /threads/search. The user's
    // turn is stored role="signal" but its text is embedded with `content`, so it
    // matches too.
    registerApiRoute('/harness/threads/search', {
      method: 'GET',
      handler: async (c) => {
        const q = (c.req.query('q') ?? '').trim();
        if (q.length < 2) {
          return c.json({ threads: [] });
        }
        const { embedding } = await embed({ model: fastembed, value: q });
        const hits = await getSharedVector().query({
          indexName: MESSAGE_VECTOR_INDEX,
          queryVector: embedding,
          topK: 24,
          filter: { resource_id: CHAT_RESOURCE_ID },
        });
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
        // Resolve display titles for the matched threads from the harness's own
        // thread list (explicit title → first non-assistant message). Only threads
        // that still exist are returned.
        const session = await getChatSession();
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
              // (the user's role="signal" message), same as /harness/threads.
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

    // Load one harness conversation's messages as v6 UIMessages (text-only
    // restore, same as the Single Agent path — richer parts rehydrate on the
    // live stream when the conversation continues).
    registerApiRoute('/harness/threads/:id/messages', {
      method: 'GET',
      handler: async (c) => {
        const session = await getChatSession();
        const messages = await session.thread.listMessages({ threadId: c.req.param('id') });
        return c.json({ messages: messages.map(toUIMessage) });
      },
    }),

    // Delete a harness conversation (hard delete; clears the binding if active).
    registerApiRoute('/harness/threads/:id', {
      method: 'DELETE',
      handler: async (c) => {
        const session = await getChatSession();
        await session.thread.delete({ threadId: c.req.param('id') });
        return c.json({ ok: true });
      },
    }),

    // Archive/unarchive or rename a harness conversation. The AgentController's
    // public `session.thread.rename`/metadata are ACTIVE-thread scoped, but the
    // harness's threads now live in the shared store, so the Memory can update any
    // thread by id (same table) — the exact path the Single Agent sidebar uses.
    registerApiRoute('/harness/threads/:id', {
      method: 'PATCH',
      handler: async (c) => {
        const id = c.req.param('id');
        const body = await c.req.json<{ archived?: boolean; title?: string }>();
        const memory = await mastra.getAgent('chat').getMemory();
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

    // Agent Harness endpoint: POST /harness/stream → SSE of HarnessEvents.
    // Body: { text: string, threadId?: string }. The Harness wraps the same
    // chatAgent but emits the richer orchestration surface (sessions, modes,
    // approvals, subagents, tasks) the AI SDK UIMessage stream can't carry.
    // The web `agent-harness` transport maps these events onto the same elements.
    registerApiRoute('/harness/stream', {
      method: 'POST',
      handler: async (c) => {
        const { text, threadId, model, webSearch, files } = await c.req.json<{
          text?: string;
          threadId?: string;
          model?: string;
          webSearch?: boolean;
          // The composer's attachments (FileUIPart): `url` is a data URL after the
          // client's submit-time blob→dataURL conversion, so it's safe to forward.
          files?: Array<{ url: string; mediaType: string; filename?: string }>;
        }>();
        if (!text?.trim()) {
          return c.json({ error: 'text is required' }, 400);
        }
        // Route the composer's "Search" toggle through the request context (not the
        // user message) so the agent's dynamic instructions flip into browse-the-web
        // mode — driving the workspace browser the Browser panel screencasts.
        let requestContext: RequestContext | undefined;
        if (webSearch === true) {
          requestContext = new RequestContext();
          requestContext.set('webSearch', true);
        }
        // Map the composer's attachments onto sendMessage's file shape ({ data, ... }).
        // `createMessageInput` accepts a data URL as `data` for both text and binary parts.
        const messageFiles = files?.length
          ? files.map((f) => ({
              data: f.url,
              mediaType: f.mediaType,
              ...(f.filename ? { filename: f.filename } : {}),
            }))
          : undefined;

        const session = await getChatSession();
        // Resume the given thread, or start a fresh thread when none is sent. No
        // placeholder title — the sidebar derives the display title from the first
        // user message (chat-app convention) until AI titling lands (see 698.11).
        if (threadId) {
          await session.thread.switch({ threadId });
        } else {
          await session.thread.create();
        }
        const activeThreadId = session.thread.requireId();

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            // Guard every enqueue: once the client disconnects the stream controller
            // closes, but the session keeps emitting events for a few ticks while the
            // run finalizes — enqueueing then throws "Controller is already closed".
            let closed = false;
            // biome-ignore lint/suspicious/noExplicitAny: SSE payloads are heterogeneous AgentControllerEvents
            const send = (obj: any) => {
              if (closed) {
                return;
              }
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
              } catch {
                closed = true; // client went away mid-run
              }
            };

            const unsubscribe = session.subscribe((event) => send(event));
            // On client disconnect: stop forwarding, drop the subscription, abort the run.
            c.req.raw.signal?.addEventListener('abort', () => {
              closed = true;
              unsubscribe();
              session.abort();
            });

            // Hand the client the active thread id so it can continue the conversation.
            send({ type: '__thread__', threadId: activeThreadId });
            try {
              // Honor the composer's model pick (validated against the same allow-list
              // the Single Agent route uses). Switching here — inside the subscribed
              // stream — lets the resulting `model_changed` event flow to the client too.
              if (model && MODEL_ALLOWLIST.has(model)) {
                await session.model.switch({ modelId: model });
              }
              await session.sendMessage({
                content: text,
                ...(messageFiles ? { files: messageFiles } : {}),
                ...(requestContext ? { requestContext } : {}),
              });
            } catch (err) {
              send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
            } finally {
              unsubscribe();
              send({ type: '__done__' });
              if (!closed) {
                try {
                  controller.close();
                } catch {
                  /* already closed */
                }
              }
            }
          },
        });

        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
          },
        });
      },
    }),

    // Agent Harness HITL: POST /harness/approve resolves a parked tool-approval
    // gate. The matching /harness/stream call is suspended at the gate; responding
    // here resumes it and the continuation events flow on that still-open SSE.
    registerApiRoute('/harness/approve', {
      method: 'POST',
      handler: async (c) => {
        const { decision } = await c.req.json<{
          decision?: 'approve' | 'decline' | 'always_allow_category';
        }>();
        if (
          decision !== 'approve' &&
          decision !== 'decline' &&
          decision !== 'always_allow_category'
        ) {
          return c.json(
            { error: 'decision must be approve | decline | always_allow_category' },
            400,
          );
        }
        const session = await getChatSession();
        session.respondToToolApproval({ decision });
        return c.json({ ok: true });
      },
    }),

    // Agent Harness HITL: POST /harness/answer resolves a parked tool SUSPENSION —
    // the agent-driven `ask_user` flow. When a request is ambiguous the agent calls
    // the built-in `ask_user`, which suspends the run (emitting `tool_suspended` with
    // the question); the matching /harness/stream call is parked awaiting the answer.
    // Posting the answer here resumes the SAME suspended tool and the continuation
    // events flow on the still-open SSE. `answer` is a string (free-text / single
    // choice) or string[] (multi-select labels); `toolCallId` selects which prompt to
    // resolve when several are pending (optional when only one is).
    registerApiRoute('/harness/answer', {
      method: 'POST',
      handler: async (c) => {
        const { answer, toolCallId } = await c.req.json<{
          answer?: string | string[];
          toolCallId?: string;
        }>();
        if (typeof answer !== 'string' && !Array.isArray(answer)) {
          return c.json({ error: 'answer must be a string or string[]' }, 400);
        }
        const session = await getChatSession();
        await session.respondToToolSuspension({
          resumeData: answer,
          ...(toolCallId ? { toolCallId } : {}),
        });
        return c.json({ ok: true });
      },
    }),

    // NOTE: modes (Chat / Plan) stay configured on the controller (see lib/harness.ts) and
    // are exercised by the integration test, but there's no HTTP switch route — planning is
    // AGENT-DRIVEN (the agent calls the built-in submit_plan when a task warrants a plan), so
    // the UI has no manual mode switcher to back.

    // Agent Harness goals: the agent's native objective mechanism (flagship demo). Goals
    // are AGENT-DRIVEN — the chat agent calls its own `setGoal` tool when it recognizes a
    // standing objective (see agents/chat.ts), which iterates toward it: after each turn a
    // judge scores the objective and the run loops (up to maxRuns) until it passes, emitting
    // `goal_evaluation` events the web folds into a goal card. These read/clear routes back
    // the card (hydrate on reload + dismiss); they drive the SAME session as /harness/stream
    // via `controller.getCurrentAgent` (the mode-backing agent with the controller's storage).

    // GET the current objective for the session's active thread ({ objective: record|null }).
    registerApiRoute('/harness/goal', {
      method: 'GET',
      handler: async (c) => {
        const controller = await getChatHarness();
        const session = await getChatSession();
        const threadId = session.thread.getId();
        if (!threadId) {
          return c.json({ objective: null });
        }
        const agent = controller.getCurrentAgent(session);
        const objective = await agent.getObjective({ threadId });
        return c.json({ objective: objective ?? null });
      },
    }),

    // Clear the objective for the active thread (the agent stops goal-driven looping).
    registerApiRoute('/harness/goal', {
      method: 'DELETE',
      handler: async (c) => {
        const controller = await getChatHarness();
        const session = await getChatSession();
        const threadId = session.thread.getId();
        if (threadId) {
          await controller.getCurrentAgent(session).clearObjective({ threadId });
        }
        return c.json({ ok: true });
      },
    }),

    // GET the current Observational-Memory record — the facts the Observer has distilled
    // across this resource's conversations. Lets the Memory panel show learned facts ON
    // LOAD (before the next run's `om_status` fills the live token windows), so a returning
    // user isn't met with an empty panel. Strips the `<thread id="…">` attribution wrappers
    // (present in resource scope) to plain text for display.
    registerApiRoute('/harness/om', {
      method: 'GET',
      handler: async (c) => {
        const controller = await getChatHarness();
        const session = await getChatSession();
        const record = await controller.getObservationalMemoryRecord(session);
        const observations =
          record?.activeObservations?.replace(/<\/?thread[^>]*>/g, '').trim() || null;
        return c.json({
          observations,
          generationCount: record?.generationCount ?? 0,
          lastObservedAt: record?.lastObservedAt ?? null,
        });
      },
    }),

    // List the recurring schedules the harness agent has set up (the Schedules
    // panel). Reads the native `mastra.schedules` service directly — the same
    // service the agent's start_schedule / stop_schedule tools write to — and
    // returns flat agent-schedule views. Read-only: creating/pausing is
    // AGENT-DRIVEN (the user asks the agent), so there's no mutate route here.
    registerApiRoute('/harness/schedules', {
      method: 'GET',
      handler: async (c) => {
        const rows = await mastra.schedules.list({ agentId: 'chat' });
        const schedules = rows
          // biome-ignore lint/suspicious/noExplicitAny: AnySchedule union — agent schedules carry agentId
          .filter((s: any) => s?.agentId)
          // biome-ignore lint/suspicious/noExplicitAny: flat AgentSchedule view
          .map((s: any) => ({
            id: String(s.id),
            cron: String(s.cron ?? ''),
            prompt: String(s.prompt ?? ''),
            status: s.status === 'paused' ? 'paused' : 'active',
            nextFireAt: typeof s.nextFireAt === 'number' ? s.nextFireAt : 0,
            lastFireAt: typeof s.lastFireAt === 'number' ? s.lastFireAt : null,
            ...(s.name ? { name: String(s.name) } : {}),
          }))
          .sort((a, b) => a.nextFireAt - b.nextFireAt);
        return c.json({ schedules });
      },
    }),

    // Serves a generated image's bytes by id (the generateImage tool stashes them
    // so they never enter the model context). Returns { base64, mediaType }.
    registerApiRoute('/images/:id', {
      method: 'GET',
      handler: async (c) => {
        const img = getImage(c.req.param('id'));
        if (!img) {
          return c.json({ error: 'image not found' }, 404);
        }
        return c.json(img);
      },
    }),

    // Workbench Files panel: read the harness agent's workspace (WORKSPACE_ROOT)
    // directly off disk. GET /workspace/files → the file tree; GET /workspace/file
    // ?path=<rel> → one file's text (confined to WORKSPACE_ROOT by the reader).
    registerApiRoute('/workspace/files', {
      method: 'GET',
      handler: async (c) => c.json({ root: WORKSPACE_ROOT, tree: await readWorkspaceTree() }),
    }),
    registerApiRoute('/workspace/file', {
      method: 'GET',
      handler: async (c) => {
        const p = c.req.query('path');
        if (!p) {
          return c.json({ error: 'path query is required' }, 400);
        }
        const file = await readWorkspaceFile(p);
        if (!file) {
          return c.json({ error: 'not found' }, 404);
        }
        return c.json(file);
      },
    }),

    // Workbench Browser panel: a live screencast (SSE) of the harness agent's Chrome
    // (the @mastra/browser-viewer instance). Launches the browser on first view, then
    // forwards base64 JPEG frames + URL changes; the agent's browser tools drive the
    // SAME window, so the panel shows what the agent sees.
    registerApiRoute('/browser/screencast', {
      method: 'GET',
      handler: async (c) => {
        const browser = await getChatBrowser();
        try {
          if (!browser.isBrowserRunning()) {
            await browser.launch();
          }
          // A blank launch has no page/target, so CDP screencast emits nothing.
          // ensureReady() gives the browser a page to capture; startScreencast then
          // emits the initial frame, and the agent's navigations produce the rest.
          await browser.ensureReady();
          const stream = await browser.startScreencast({
            format: 'jpeg',
            quality: 70,
            maxWidth: 1280,
            maxHeight: 720,
          });

          const encoder = new TextEncoder();
          const body = new ReadableStream<Uint8Array>({
            async start(controller) {
              const send = (obj: unknown) => {
                try {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
                } catch {
                  /* stream already closed */
                }
              };
              stream.on('frame', (f: { data: string; viewport: unknown }) =>
                send({ type: 'frame', data: f.data, viewport: f.viewport }),
              );
              stream.on('url', (url: string) => send({ type: 'url', url }));
              stream.on('error', (e: unknown) =>
                send({ type: 'error', error: e instanceof Error ? e.message : String(e) }),
              );
              stream.on('stop', (reason: string) => {
                send({ type: 'stop', reason });
                try {
                  controller.close();
                } catch {
                  /* already closed */
                }
              });
              // `startScreencast()` returns an already-started stream, so listeners
              // are attached here and frames flow immediately.
              // Stop the screencast when the panel disconnects.
              c.req.raw.signal?.addEventListener('abort', () => {
                stream.stop().catch(() => {});
                try {
                  controller.close();
                } catch {
                  /* already closed */
                }
              });
            },
          });

          return new Response(body, {
            headers: {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache, no-transform',
              connection: 'keep-alive',
            },
          });
        } catch (err) {
          return c.json(
            { error: err instanceof Error ? err.message : 'screencast unavailable' },
            503,
          );
        }
      },
    }),
  ],
  ...(env.MASTRA_JWT_SECRET ? { auth: new MastraJwtAuth({ secret: env.MASTRA_JWT_SECRET }) } : {}),
};

export const mastra = new Mastra({
  server: serverConfig,
  agents: { chat: chatAgent },
  mcpServers: { baseMcp: mcpServer },
  storage,
  logger: new PinoLogger({
    name: 'Mastra',
    level: env.LOG_LEVEL,
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
  editor: new MastraEditor(),
});
