/**
 * The main chat's tools for the threads it started: list them, read one, and send one a
 * message. With them the main chat's agent can answer "how is the website going?" and pass
 * on "make the funnel use the site's colours" without the person opening the thread. And one
 * for threads it has not started: `suggest_threads` offers them on a card, and the person
 * picks which to start.
 *
 * Every tool works only on threads the calling chat started (same resource, same parent),
 * and only from that chat: a thread never steers another thread.
 */

import type { RequestContext } from '@mastra/core/request-context';
import type { MastraStorage } from '@mastra/core/storage';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { messageText as anyText } from './thread-utils';
import { type WorkThreadInfo, workThreadOf } from './work-thread-info';
import { excerpt } from './work-thread-text';

export const LIST_THREADS_TOOL = 'list_threads';
export const READ_THREAD_TOOL = 'read_thread';
export const MESSAGE_THREAD_TOOL = 'message_thread';
export const SUGGEST_THREADS_TOOL = 'suggest_threads';

/** How many threads one `suggest_threads` card offers at most. */
export const MAX_SUGGESTIONS = 6;

/** How many of a thread's latest messages `read_thread` returns. */
export const READ_MESSAGES = 12;

export type SteeringDeps = {
  storage: MastraStorage;
  /** Sends a work thread a message, running it now or once the run in progress ends. */
  message: (input: {
    threadId: string;
    resourceId: string;
    text: string;
    requestContext?: RequestContext;
  }) => Promise<{ running: boolean }>;
  /**
   * Whether a `message_thread` call waits for the user's yes, by the host's rule for the
   * calling run (`requireApproval` on the work threads, as for `start_thread`).
   */
  requireApproval?: ((requestContext: unknown) => boolean) | undefined;
  /** The host's screen for a thread's words before an agent reads them (`screenReport`). */
  screen?: ((text: string, thread: WorkThreadInfo) => string) | undefined;
  /**
   * Whether the calling run read untrusted content (`startsUntrusted` on the work threads).
   * Such a run can't suggest threads: the person sees a suggestion's title, not its brief, so
   * a brief written after reading outside text goes through `start_thread` and its rules.
   */
  untrusted?: ((requestContext: unknown) => boolean) | undefined;
  /**
   * Fields added to a refused suggestion's result: a host's marker, say, telling its memory to
   * drop the call's briefs, so no later run can reuse a brief written after reading outside
   * text.
   */
  refusal?: Record<string, unknown> | undefined;
  /** The specialists a thread can run as (`agents` on the work threads), for suggestions. */
  agents?: ReadonlyArray<{ id: string; description: string }> | undefined;
};

type ToolContext = {
  agent?: { threadId?: string; resourceId?: string };
  requestContext?: RequestContext;
};

/** Reading a thread never waits for anyone: a host that asks by default must not ask here. */
const neverAsks = () => false;

export function createSteeringTools(deps: SteeringDeps) {
  const memory = async () => {
    const store = await deps.storage.getStore('memory');
    if (!store) throw new Error('work threads need a memory store');
    return store;
  };

  /** The calling chat and its resource; refused inside a work thread. */
  async function caller(ctx: ToolContext | undefined) {
    const chatId = ctx?.agent?.threadId;
    const resourceId = ctx?.agent?.resourceId;
    if (!chatId || !resourceId) throw new Error('Only a conversation can steer its threads.');
    const store = await memory();
    if (workThreadOf(await store.getThreadById({ threadId: chatId }))) {
      throw new Error('Only the main chat steers threads: inside a thread, do the work yourself.');
    }
    return { chatId, resourceId };
  }

  /** One of the calling chat's threads, or a refusal naming the mix-up. */
  async function ownThread(ctx: ToolContext | undefined, threadId: string) {
    const { chatId, resourceId } = await caller(ctx);
    const store = await memory();
    const thread = await store.getThreadById({ threadId });
    const info = workThreadOf(thread);
    if (!thread || !info || thread.resourceId !== resourceId || info.parentThreadId !== chatId) {
      throw new Error('This chat started no thread with that id. Use list_threads for the ids.');
    }
    return { resourceId, info };
  }

  const screen = (text: string, info: WorkThreadInfo) =>
    deps.screen ? deps.screen(text, info) : text;

  const listThreads = createTool({
    id: LIST_THREADS_TOOL,
    description:
      'The threads this chat started, newest first: id, title, who does the work, status (queued, working, needs_you, done, failed, stopped), its checklist progress and latest line. Use it to answer how the work is going, or to find a thread to read or message.',
    inputSchema: z.object({}),
    requireApproval: neverAsks,
    execute: async (_input, ctx) => {
      const { chatId, resourceId } = await caller(ctx as ToolContext);
      const store = await memory();
      const { threads } = await store.listThreads({ perPage: false, filter: { resourceId } });
      const own = threads
        .map((thread) => ({ thread, info: workThreadOf(thread) }))
        .filter(
          (t): t is { thread: (typeof threads)[number]; info: WorkThreadInfo } =>
            t.info?.parentThreadId === chatId,
        )
        .sort((a, b) => +new Date(b.thread.updatedAt) - +new Date(a.thread.updatedAt));
      return {
        threads: own.map(({ thread, info }) => ({
          threadId: thread.id,
          title: info.title,
          status: info.status,
          ...(info.agent ? { agent: info.agent.name } : {}),
          ...(info.tasks
            ? {
                progress: `${info.tasks.filter((t) => t.status === 'completed').length}/${info.tasks.length}`,
              }
            : {}),
          ...(info.latest ? { latest: screen(info.latest, info) } : {}),
          ...(info.resolved ? { resolved: true } : {}),
        })),
      };
    },
  });

  const readThread = createTool({
    id: READ_THREAD_TOOL,
    description: `What one of this chat's threads has done so far: its status, its checklist and its latest ${READ_MESSAGES} messages, each trimmed. Read it before answering a question about a thread's work, or before messaging it.`,
    inputSchema: z.object({ threadId: z.string().min(1).max(64) }),
    requireApproval: neverAsks,
    execute: async ({ threadId }, ctx) => {
      const { info } = await ownThread(ctx as ToolContext, threadId);
      const store = await memory();
      const { messages } = await store.listMessages({ threadId, perPage: false });
      return {
        title: info.title,
        status: info.status,
        ...(info.tasks ? { checklist: info.tasks } : {}),
        messages: messages
          .map((m) => ({ from: m.role === 'assistant' ? 'thread' : 'to_thread', text: anyText(m) }))
          .filter((m) => m.text.trim())
          .slice(-READ_MESSAGES)
          .map((m) => ({ from: m.from, text: excerpt(screen(m.text, info)) })),
      };
    },
  });

  const messageThread = createTool({
    id: MESSAGE_THREAD_TOOL,
    description:
      "Send one of this chat's threads a message: a change of plan, an answer it needs, or something to use. An idle thread starts working on it; a working one takes it up as soon as it finishes what it is doing. It reports back here when it finishes. Not for a thread that is queued (it has not started) or waiting for the person (they answer in the thread).",
    inputSchema: z.object({
      threadId: z.string().min(1).max(64),
      message: z
        .string()
        .min(1)
        .max(4000)
        .describe("What to tell it, in the user's words where possible."),
    }),
    ...(deps.requireApproval
      ? {
          requireApproval: (_input: unknown, ctx?: { requestContext?: unknown }) =>
            deps.requireApproval?.(ctx?.requestContext) ?? false,
        }
      : {}),
    execute: async ({ threadId, message }, ctx) => {
      const { resourceId, info } = await ownThread(ctx as ToolContext, threadId);
      if (info.status === 'queued') {
        throw new Error('That thread has not started yet. It starts when another one finishes.');
      }
      if (info.status === 'needs_you') {
        throw new Error(
          'That thread is waiting for the person. Tell them; they answer it in the thread.',
        );
      }
      const requestContext = (ctx as ToolContext | undefined)?.requestContext;
      const { running } = await deps.message({
        threadId,
        resourceId,
        text: `From the main chat: ${message}`,
        ...(requestContext ? { requestContext } : {}),
      });
      return { threadId, title: info.title, delivered: running ? 'after_current_work' : 'now' };
    },
  });

  const agentIds = (deps.agents ?? []).map((a) => a.id);
  const suggestion = z.object({
    title: z.string().min(1).max(80).describe('A few words naming the work.'),
    why: z.string().min(1).max(200).describe('One line on why it is worth doing.'),
    brief: z
      .string()
      .min(1)
      .max(8000)
      .describe('The whole task, as start_thread would get it: the thread does not see this chat.'),
    ...(agentIds.length > 0
      ? {
          agent: z
            .enum(agentIds as [string, ...string[]])
            .optional()
            .describe('Who would do the work, as for start_thread.'),
        }
      : {}),
  });

  const suggestThreads = createTool({
    id: SUGGEST_THREADS_TOOL,
    description: `Offer the person threads to start, instead of starting them yourself. They show as a card under your message, with a Start button for each and one to start them all. Use it when the person asks what could be done, or when a request splits into several pieces of work they may not all want. Give each a short title, one line on why, and the brief start_thread would get. Then stop and let them pick: when they say to start a suggested thread, call start_thread with that suggestion's title, brief and agent unchanged. If that suggestion is no longer in this conversation, ask them what the thread should do rather than guessing. At most ${MAX_SUGGESTIONS}. Not for one quick step: do that yourself.`,
    inputSchema: z.object({
      threads: z
        .array(suggestion)
        .min(1)
        .max(MAX_SUGGESTIONS)
        .refine(
          (list) => new Set(list.map((t) => t.title.trim().toLowerCase())).size === list.length,
          'Give each suggestion a title of its own.',
        ),
    }),
    requireApproval: neverAsks,
    execute: async ({ threads }, ctx) => {
      await caller(ctx as ToolContext);
      // Refused as a result, not thrown, so the host's fields reach whatever stores it (its
      // memory, which can drop the briefs the call carried).
      if (deps.untrusted?.((ctx as ToolContext | undefined)?.requestContext)) {
        return {
          refused:
            'This turn read outside content, so it cannot suggest threads. Start the ones that are needed with start_thread instead.',
          ...deps.refusal,
        };
      }
      return { suggested: threads.map((t) => t.title) };
    },
  });

  return {
    [SUGGEST_THREADS_TOOL]: suggestThreads,
    [LIST_THREADS_TOOL]: listThreads,
    [READ_THREAD_TOOL]: readThread,
    [MESSAGE_THREAD_TOOL]: messageThread,
  };
}

export type SteeringTools = ReturnType<typeof createSteeringTools>;
