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
import { MastraEditor } from '@mastra/editor';
import { fastembed } from '@mastra/fastembed';
import { PinoLogger } from '@mastra/loggers';
import { MCPServer } from '@mastra/mcp';
import { DefaultExporter, Observability, SensitiveDataFilter } from '@mastra/observability';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  embed,
  generateText,
  streamText,
} from 'ai';
import { leadIntakeAgent } from './agents/_example';
import { chatAgent } from './agents/chat';
import { codeAgent } from './agents/code';
import { doltConfigured, ensureDatabase } from './lib/dolt';
import { getChatBrowser, getChatSession, WORKSPACE_ROOT } from './lib/harness';
import { getImage } from './lib/image-store';
import { getSharedStore, getSharedVector, MESSAGE_VECTOR_INDEX } from './lib/memory';
import { messageText, searchSnippet, threadTitle, toUIMessage } from './lib/thread-utils';
import { readWorkspaceFile, readWorkspaceTree } from './lib/workspace-files';
import {
  hallucinationScorer,
  promptAlignmentScorer,
  urgencyScorer,
} from './scorers/_example.scorers';
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
  // Dolt versioned-data tools exposed over MCP. To let the example agent call
  // them directly, spread `...doltTools` into the agent's own `tools`.
  tools: { ...doltTools },
  agents: { leadIntake: leadIntakeAgent },
});

// One libSQL/Turso store serves every Mastra domain (default, editor, and
// observability). Local dev uses a file: DB — no server, no Docker; prod points
// TURSO_DATABASE_URL at a libsql:// Turso URL with TURSO_AUTH_TOKEN. libSQL has
// native vector search, so there's no DuckDB (observability) or pgvector to run.
// To switch the whole kit to Postgres instead, see docs/postgres.md.
// The ONE shared libSQL store — same instance the agents' Memory and the harness
// AgentController use, so threads/messages never split across DB files.
const storage = getSharedStore();

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
    // Single Agent endpoint: POST /chat/:agentId → AI SDK v6 UIMessage stream.
    // We drive it with `handleChatStream` directly (rather than the `chatRoute`
    // helper) because that exposes two things the helper hides:
    //   1. `messageMetadata` — attach the finish-step token usage to the assistant
    //      message so the <Context> element can render REAL input/output/reasoning
    //      tokens (chatRoute gives no usage; the bare `finish` chunk carries none).
    //   2. per-request `model` — honor the composer's model picker (body.model),
    //      validated against an allow-list, so the <Model Selector> actually switches
    //      the model for the turn instead of being ignored.
    // sendReasoning/sendSources surface the Reasoning + Sources elements; maxSteps
    // lets the agent loop after tool calls to produce a final grounded answer.
    registerApiRoute('/chat/:agentId', {
      method: 'POST',
      handler: async (c) => {
        const body = await c.req.json<{
          messages?: unknown[];
          trigger?: 'submit-message' | 'regenerate-message';
          model?: string;
          webSearch?: boolean;
          threadId?: string;
        }>();
        const agentId = c.req.param('agentId');
        // Persist this turn into a thread so it appears in the chat-history sidebar.
        // Single local user (no auth) → one resourceId; the client supplies threadId.
        const memory =
          typeof body.threadId === 'string' && body.threadId
            ? { thread: body.threadId, resource: LOCAL_RESOURCE }
            : undefined;
        // Only allow the models the UI offers — never trust an arbitrary body.model.
        const chosenModel =
          typeof body.model === 'string' && MODEL_ALLOWLIST.has(body.model)
            ? body.model
            : undefined;
        // Composer "Search" toggle. The code agent has a sandbox, not web search.
        const useWebSearch = body.webSearch === true && agentId !== 'code';

        // Shared: attach finish-step token usage to message.metadata (drives <Context>).
        // biome-ignore lint/suspicious/noExplicitAny: v6 finish part shape
        const usageFrom = (part: any) => {
          if (part?.type === 'finish' && part.totalUsage) {
            const u = part.totalUsage;
            return {
              model: chosenModel ?? env.CHAT_MODEL,
              usage: {
                inputTokens: u.inputTokens,
                outputTokens: u.outputTokens,
                totalTokens: u.totalTokens,
                reasoningTokens: u.reasoningTokens,
                cachedInputTokens: u.cachedInputTokens,
              },
            };
          }
          return undefined;
        };

        // Web-search turns bypass Mastra's agent loop (which truncates Anthropic's
        // provider-executed web_search — see note on webSearchTool) and run on the
        // AI SDK directly, streamed to the SAME v6 UIMessage transport + elements.
        if (useWebSearch) {
          const primaryModel = chosenModel ?? env.CHAT_MODEL; // full router id (provider/model)
          // Flatten the UIMessage[] text parts into ModelMessage[] (text-only is fine
          // for a web-search turn). convertToModelMessages() misbehaves here, so map directly.
          // biome-ignore lint/suspicious/noExplicitAny: UIMessage[] from useChat
          const modelMessages = ((body.messages ?? []) as any[])
            .map((m) => ({
              role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
              content: Array.isArray(m.parts)
                ? m.parts
                    // biome-ignore lint/suspicious/noExplicitAny: part union
                    .filter((p: any) => p?.type === 'text')
                    // biome-ignore lint/suspicious/noExplicitAny: part union
                    .map((p: any) => p.text ?? '')
                    .join('\n')
                : typeof m.content === 'string'
                  ? m.content
                  : '',
            }))
            .filter((m) => m.content.trim().length > 0);

          // Model chain: the chosen model (each attempt internally retries 4× with
          // backoff on transient errors), then Haiku as an overload fallback.
          const chain =
            primaryModel === WEB_SEARCH_FALLBACK_MODEL
              ? [primaryModel]
              : [primaryModel, WEB_SEARCH_FALLBACK_MODEL];
          const uiOpts = {
            sendSources: true,
            sendReasoning: true,
            // biome-ignore lint/suspicious/noExplicitAny: v6 finish part shape
            messageMetadata: ({ part }: { part: any }) => usageFrom(part),
          };

          const stream = createUIMessageStream({
            onError: (e) =>
              isOverloaded(e)
                ? 'The model is overloaded right now — please try again.'
                : 'An error occurred.',
            execute: async ({ writer }) => {
              for (let i = 0; i < chain.length; i++) {
                const isLast = i === chain.length - 1;
                let caught: unknown;
                // Resolve the provider-native model + web_search tool for this attempt.
                const { model, tools } = resolveWebSearch(chain[i]);
                const result = streamText({
                  model,
                  system: WEB_SEARCH_SYSTEM,
                  // biome-ignore lint/suspicious/noExplicitAny: ModelMessage[] role union
                  messages: modelMessages as any,
                  tools,
                  maxRetries: 4,
                  onError: ({ error }) => {
                    caught = error;
                  },
                });

                // Buffer the opening frames so that, if the request fails BEFORE any
                // real content (the overload case), we can discard them and silently
                // retry on the next model — the client never sees a partial message.
                // biome-ignore lint/suspicious/noExplicitAny: UI chunk union
                const buffered: any[] = [];
                let committed = false;
                let failed = false;
                for await (const chunk of result.toUIMessageStream(uiOpts)) {
                  if (!committed) {
                    if (chunk.type === 'error') {
                      failed = true;
                      break;
                    }
                    if (chunk.type === 'start' || chunk.type === 'start-step') {
                      buffered.push(chunk);
                      continue;
                    }
                    for (const b of buffered) {
                      writer.write(b);
                    }
                    writer.write(chunk);
                    committed = true;
                    continue;
                  }
                  writer.write(chunk);
                }

                if (!failed) {
                  return; // streamed a real answer
                }
                // Fall back to the next model only on a genuine overload.
                if (!isLast && isOverloaded(caught)) {
                  continue;
                }
                // Otherwise surface a clean error frame to the client.
                if (buffered.length === 0) {
                  writer.write({ type: 'start' });
                } else {
                  for (const b of buffered) {
                    writer.write(b);
                  }
                }
                writer.write({
                  type: 'error',
                  errorText: isOverloaded(caught)
                    ? 'The model is overloaded right now — please try again.'
                    : 'An error occurred.',
                });
                return;
              }
            },
          });

          return createUIMessageStreamResponse({ stream });
        }

        const stream = await handleChatStream({
          mastra,
          agentId,
          version: 'v6',
          sendReasoning: true,
          sendSources: true,
          params: {
            // biome-ignore lint/suspicious/noExplicitAny: pass the UIMessage[] body through verbatim
            messages: (body.messages ?? []) as any,
            trigger: body.trigger,
            ...(memory ? { memory } : {}),
          },
          defaultOptions: {
            // The Code Agent needs room to write → run → fix; the chat agent needs few.
            maxSteps: agentId === 'code' ? 12 : 5,
            ...(chosenModel ? { model: chosenModel } : {}),
          },
          messageMetadata: ({ part }) => usageFrom(part),
        });

        return createUIMessageStreamResponse({ stream });
      },
    }),

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
        let title = '';
        try {
          const { text } = await generateText({
            model: anthropic('claude-haiku-4-5'),
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
    // to the first user message (Foreman-style) until AI titling lands (698.11).
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

    // Title/first-message search over the harness's conversations (v1: no
    // semantic recall — the harness store isn't in the fastembed message index).
    registerApiRoute('/harness/threads/search', {
      method: 'GET',
      handler: async (c) => {
        const q = (c.req.query('q') ?? '').trim();
        if (q.length < 2) {
          return c.json({ threads: [] });
        }
        const session = await getChatSession();
        const threads = await session.thread.list();
        const ids = threads.map((t) => t.id);
        const firstMsgs = ids.length
          ? await session.thread.firstUserMessages({ threadIds: ids })
          : new Map();
        const ql = q.toLowerCase();
        const results = threads
          .map((t) => {
            const first = messageText(firstMsgs.get(t.id));
            return { id: t.id, title: threadTitle(t, first), first };
          })
          .filter((r) => r.title.toLowerCase().includes(ql) || r.first.toLowerCase().includes(ql))
          .map((r) => ({
            id: r.id,
            title: r.title,
            snippet: r.first ? searchSnippet(r.first, q) : '',
            score: 1,
          }));
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
        // user message (Foreman-style) until AI titling lands (see 698.11).
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
  agents: { leadIntake: leadIntakeAgent, chat: chatAgent, code: codeAgent },
  scorers: { hallucinationScorer, promptAlignmentScorer, urgencyScorer },
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
        exporters: [new DefaultExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
  editor: new MastraEditor(),
});
