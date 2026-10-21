'use client';

import { ChevronRightIcon, PanelLeftIcon, SendIcon, SquareIcon, XIcon } from 'lucide-react';
import {
  type FormEvent,
  Fragment,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { ApprovalViews } from '@/components/chat/approval-view';
import {
  messagePieces,
  ToolStepList,
  type ToolViews,
  withPlainSteps,
} from '@/components/chat/tool-steps';
import { AskUserPrompt } from '@/components/chat/tool-views';
import { ApprovalCards, partKey, TranscriptPart } from '@/components/chat/transcript';
import {
  type UseAgentControllerChat,
  useAgentControllerChat,
} from '@/lib/agent-controller/use-agent-controller-chat';
import { type ThreadItem, useThreads } from '@/lib/agent-controller/use-threads';
import { cn } from '@/lib/utils';
import { ProjectSidebar } from './project-sidebar';
import { ThreadRow, ThreadStatus, threadIdFromHref } from './thread-row';

/** How often thread statuses are re-read while one is working. */
const POLL_MS = 3000;

/** An ordinary conversation, as opposed to a work thread. */
const isConversation = (t: ThreadItem) => !t.parentThreadId;

/**
 * A chat shaped like a project: chats, and threads each chat starts for pieces of work.
 *
 * The list on the left holds every chat, newest first, with its threads under it: New chat
 * starts another, and each can be renamed or deleted (its threads go with it). The page
 * opens on the newest chat.
 *
 * The agent starts a thread with its `start_thread` tool (server: lib/work-threads.ts). The
 * thread shows up as a row under the message that started it, with its status (working,
 * needs you, done). Clicking the row opens the thread's own conversation in a panel beside
 * the chat, where you can answer its approvals and questions and steer it; closing the panel
 * leaves the chat as it was. When
 * a thread finishes or stops for you, a short note with a link to it lands in the main
 * chat (saved by the server, no model call).
 *
 * Two engines run side by side, one per view, so a chat keeps streaming while a thread is
 * open. Every tool call shows as a step row, folded into one line per run, unless the host's
 * `toolViews` draws it some other way.
 *
 *   <ProjectChat />
 */
export function ProjectChat({
  className,
  approvalViews,
  toolViews,
  modes,
  isChat = isConversation,
  placeholder = 'Ask anything…',
  emptyText = 'Ask for anything. Bigger pieces of work get a thread of their own.',
}: {
  className?: string;
  /** What approval cards say, per tool name (components/chat/approval-view.tsx). */
  approvalViews?: ApprovalViews | undefined;
  /** How the host's own tools show in both views (chat/tool-steps.tsx). */
  toolViews?: ToolViews | undefined;
  /**
   * Controller modes the person can pick in the main chat, first one selected. Fewer than
   * two shows no picker.
   */
  modes?: ReadonlyArray<{ id: string; name: string }> | undefined;
  /**
   * Which conversations are chats in the list. Defaults to every one that is not a work
   * thread; a host with conversations of its own (a site's, say) leaves those out.
   */
  isChat?: ((t: ThreadItem) => boolean) | undefined;
  placeholder?: string;
  emptyText?: string;
}) {
  const main = useAgentControllerChat();
  const thread = useAgentControllerChat();
  const { threads, refresh, rename, remove } = useThreads({ refreshSignal: main.refreshSignal });
  const [openId, setOpenId] = useState<string | null>(null);
  const [threadRunning, setThreadRunning] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [mainId, setMainId] = useMainThread(main, isChat);

  const work = new Map(threads.filter((t) => t.parentThreadId).map((t) => [t.id, t]));
  const opened = openId ? work.get(openId) : undefined;
  const mainBusy = main.status === 'streaming';
  const chats = threads.filter((t) => isChat(t) && !t.archived);
  // Each chat's threads, oldest first (the list comes newest first).
  const threadsOf = new Map<string, ThreadItem[]>();
  for (const t of [...work.values()].reverse()) {
    const parent = t.parentThreadId as string;
    threadsOf.set(parent, [...(threadsOf.get(parent) ?? []), t]);
  }

  // The engines' functions are stable; the objects around them are not.
  const { openThread: openInThread } = thread;
  const { openThread: openInMain } = main;
  // Only the latest open (or going back) counts: a slow one never lands over a newer one.
  const openSeq = useRef(0);
  const open = useCallback(
    async (id: string) => {
      const seq = ++openSeq.current;
      setOpenId(id);
      const { running, stale } = await openInThread(id);
      if (!stale && seq === openSeq.current) setThreadRunning(running);
    },
    [openInThread],
  );
  const back = () => {
    openSeq.current++;
    setOpenId(null);
    setThreadRunning(false);
  };

  const { reset: resetMain } = main;
  const newChat = () => {
    back();
    setListOpen(false);
    resetMain();
    setMainId(null);
  };
  const selectChat = (id: string) => {
    back();
    setListOpen(false);
    if (id === mainId) return;
    setMainId(id);
    void openInMain(id);
  };
  // A thread opens over its own chat, so going back lands on the chat that started it.
  const openFromList = (id: string) => {
    setListOpen(false);
    const parent = work.get(id)?.parentThreadId;
    if (parent && parent !== mainId && !mainBusy) {
      setMainId(parent);
      void openInMain(parent);
    }
    void open(id);
  };
  const deleteChat = async (chat: ThreadItem) => {
    const ok = await remove(chat);
    void refresh();
    if (ok && chat.id === mainId) newChat();
    return ok;
  };

  // Report notes link to their thread as `#thread=<id>`; open it here instead of navigating.
  const onLinkClick = (e: MouseEvent) => {
    const id = threadIdFromHref(
      (e.target as HTMLElement).closest('a')?.getAttribute('href') ?? null,
    );
    if (!id) return;
    e.preventDefault();
    void open(id);
  };

  // While a thread is working, re-read statuses (one waiting on the person changes only when
  // they act, in that thread). When one changes, its report has
  // landed in the main chat (reload it unless it is mid-turn, which reloads anyway), and
  // an open thread has moved on (reload it unless it is streaming its own turn).
  const statuses = threads
    .filter((t) => t.parentThreadId)
    .map((t) => `${t.id}:${t.status}`)
    .join();
  const active = /:working(,|$)/.test(statuses) || threadRunning;
  const threadBusy = thread.status === 'streaming';
  const lastStatuses = useRef(statuses);
  // A report that landed during a main-chat turn is shown once the turn ends.
  const mainStale = useRef(false);
  useEffect(() => {
    if (mainBusy || !mainStale.current || !mainId) return;
    mainStale.current = false;
    void openInMain(mainId);
  }, [mainBusy, mainId, openInMain]);
  useEffect(() => {
    const before = lastStatuses.current;
    if (before === statuses) return;
    lastStatuses.current = statuses;
    mainStale.current = true;
    if (mainId && !mainBusy) {
      mainStale.current = false;
      void openInMain(mainId);
    }
    if (openId && !threadBusy) void open(openId);
  }, [statuses, mainId, mainBusy, openInMain, openId, threadBusy, open]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void refresh();
      if (openId && threadRunning && !threadBusy) void open(openId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh, openId, threadRunning, threadBusy, open]);

  // Escape closes the list where it opens over the chat (a phone).
  useEffect(() => {
    if (!listOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setListOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [listOpen]);

  const chatTitle = chats.find((c) => c.id === mainId)?.title || 'Chat';
  const closeThread = () => {
    back();
    void refresh();
  };

  // An open thread sits beside its chat, as a panel on the right, so both stay in view. On a
  // narrow screen it covers the chat instead.
  const threadPanel = openId && (
    <section
      aria-label={opened?.title ?? 'Thread'}
      className="flex min-h-0 min-w-0 flex-col border-border bg-background max-lg:absolute max-lg:inset-0 max-lg:z-10 lg:w-[min(36rem,50%)] lg:shrink-0 lg:border-l"
    >
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <nav aria-label="Thread" className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <button
            type="button"
            onClick={closeThread}
            aria-label={`Back to ${chatTitle}`}
            className="min-w-0 max-w-[45%] shrink-0 truncate rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {chatTitle}
          </button>
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate font-medium">{opened?.title ?? 'Thread'}</span>
        </nav>
        <ThreadStatus status={opened?.status} />
        <button
          type="button"
          onClick={closeThread}
          aria-label="Close thread"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" aria-hidden />
        </button>
      </div>
      <ChatView
        controller={thread}
        approvalViews={approvalViews}
        toolViews={toolViews}
        emptyText="This thread has no messages yet."
        working={threadRunning}
        onOpenThread={open}
        onLinkClick={onLinkClick}
        work={work}
      />
      <Composer
        placeholder={threadRunning ? 'This thread is working…' : 'Steer this thread…'}
        disabled={threadRunning}
        busy={thread.status === 'streaming'}
        onSend={(text) => thread.sendMessage(text)}
      />
    </section>
  );

  return (
    <div className={cn('relative flex h-full min-h-0', className)}>
      <ProjectSidebar
        chats={chats}
        threadsOf={threadsOf}
        activeChatId={mainId}
        openThreadId={openId}
        // A chat that is answering keeps its place until the answer ends.
        busy={mainBusy}
        onSelectChat={selectChat}
        onOpenThread={openFromList}
        onNew={newChat}
        onRename={rename}
        onDelete={deleteChat}
        className={cn(
          'w-60 shrink-0 border-border border-r bg-background',
          listOpen ? 'absolute inset-y-0 left-0 z-20 shadow-lg' : 'max-md:hidden',
        )}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => setListOpen((v) => !v)}
          aria-label={listOpen ? 'Hide chats' : 'Show chats'}
          aria-expanded={listOpen}
          aria-controls="project-chats"
          className="m-1 flex size-9 items-center justify-center self-start rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
        >
          <PanelLeftIcon className="size-4" />
        </button>
        <ChatView
          controller={main}
          approvalViews={approvalViews}
          toolViews={toolViews}
          emptyText={emptyText}
          working={false}
          onOpenThread={open}
          onLinkClick={onLinkClick}
          work={work}
          openThreadId={openId}
        />
        <Composer
          placeholder={placeholder}
          busy={mainBusy}
          modes={modes}
          onSend={(text, mode) => main.sendMessage(text, mode ? { mode } : undefined)}
        />
      </div>
      {threadPanel}
    </div>
  );
}

/**
 * The chat on show. It starts as the newest chat (`isChat`, read once), opened into `main`;
 * with none, the first message makes one. A new chat's id is picked up once its first message
 * makes it.
 */
function useMainThread(
  main: UseAgentControllerChat,
  isChat: (t: ThreadItem) => boolean,
): [string | null, (id: string | null) => void] {
  const [mainId, setPicked] = useState<string | null>(null);
  const firstIsChat = useRef(isChat);
  // Once the person picks a chat (or a new one), the first pick, if still loading, gives way.
  const chosen = useRef(false);
  const setMainId = useCallback((id: string | null) => {
    chosen.current = true;
    setPicked(id);
  }, []);
  const picked = useRef(false);
  const { openThread, activeThreadId } = main;
  useEffect(() => {
    if (picked.current) return;
    picked.current = true;
    void (async () => {
      try {
        const res = await fetch('/api/agent-controller/threads', { cache: 'no-store' });
        const data = (await res.json()) as { threads?: ThreadItem[] };
        const first = (data.threads ?? []).find((t) => firstIsChat.current(t) && !t.archived);
        if (first && !chosen.current) {
          setPicked(first.id);
          await openThread(first.id);
        }
      } catch {
        // No history to show; the first message starts the main chat.
      }
    })();
  }, [openThread]);
  // A first message with no chat open makes one: that is the chat now.
  useEffect(() => {
    if (!mainId && activeThreadId) setMainId(activeThreadId);
  }, [mainId, activeThreadId, setMainId]);
  return [mainId, setMainId];
}

/** One conversation: its messages (with thread rows), and what it waits on. */
export function ChatView({
  controller,
  approvalViews,
  emptyText,
  working,
  onOpenThread,
  onLinkClick,
  work,
  toolViews,
  openThreadId = null,
}: {
  controller: UseAgentControllerChat;
  approvalViews?: ApprovalViews | undefined;
  /** How the host's own tools show: as short step rows, or as cards (chat/tool-steps.tsx). */
  toolViews?: ToolViews | undefined;
  emptyText: string;
  /** A run going on the server that this view is not streaming (a thread's own). */
  working: boolean;
  onOpenThread: (threadId: string) => void;
  onLinkClick: (e: MouseEvent) => void;
  work: Map<string, ThreadItem>;
  /** The thread open beside this chat, whose row shows as selected. */
  openThreadId?: string | null;
}) {
  const { transcript, status, answerQuestion, pendingSuspension } = controller;
  const busy = status === 'streaming';
  const views = useMemo(() => withPlainSteps(toolViews), [toolViews]);
  const lastAssistant = transcript.messages.findLastIndex((m) => m.role !== 'user');
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: delegates clicks on the report links inside, which are focusable anchors already.
    <div className="min-h-0 flex-1" onClick={onLinkClick}>
      <Conversation className="h-full">
        <ConversationContent className="mx-auto w-full max-w-2xl">
          {transcript.messages.length === 0 && (
            <p className="py-12 text-center text-muted-foreground text-sm">{emptyText}</p>
          )}
          {transcript.messages.map((m, at) => {
            // tool_result parts arrive apart from their tool_call; pair them by id.
            const resultsById = new Map(
              m.content
                .filter((p) => p.type === 'tool_result')
                .map((p) => [
                  (p as { id: string }).id,
                  p as { result?: unknown; isError?: boolean },
                ]),
            );
            // The turn streaming now is the last assistant message (a follow-up may sit below it).
            const live = busy && at === lastAssistant;
            return (
              <Message key={m.id} from={m.role === 'user' ? 'user' : 'assistant'}>
                <MessageContent>
                  {messagePieces(m.id, m.content, views, live).map((piece) => {
                    if (piece.kind === 'steps') {
                      return <ToolStepList key={piece.key} steps={piece.steps} />;
                    }
                    if (piece.kind === 'card') {
                      return <Fragment key={piece.key}>{piece.node}</Fragment>;
                    }
                    const { part, index: i } = piece;
                    const call = part as {
                      type: string;
                      id?: string;
                      name?: string;
                      args?: unknown;
                    };
                    if (call.type === 'tool_call' && call.name === 'start_thread') {
                      const result = resultsById.get(call.id ?? '')?.result as
                        | { threadId?: string; title?: string }
                        | undefined;
                      const title =
                        result?.title ?? (call.args as { title?: string } | undefined)?.title ?? '';
                      return (
                        <ThreadRow
                          key={partKey(m.id, i)}
                          title={title}
                          threadId={result?.threadId}
                          status={result?.threadId ? work.get(result.threadId)?.status : undefined}
                          open={Boolean(result?.threadId) && result?.threadId === openThreadId}
                          onOpen={onOpenThread}
                        />
                      );
                    }
                    return (
                      <TranscriptPart
                        key={partKey(m.id, i)}
                        part={part}
                        resultsById={resultsById}
                        controller={controller}
                      />
                    );
                  })}
                </MessageContent>
              </Message>
            );
          })}

          {((busy && transcript.messages.at(-1)?.role === 'user') || working) && (
            <Shimmer className="text-muted-foreground text-sm">
              {working ? 'Working…' : 'Thinking…'}
            </Shimmer>
          )}

          {transcript.error && (
            <p role="alert" className="text-destructive text-sm">
              {transcript.error}
            </p>
          )}

          {/* A question parks the run until it's answered. */}
          {pendingSuspension && (
            <AskUserPrompt suspension={pendingSuspension} onAnswer={answerQuestion} />
          )}

          {/* Gated tools park the run until someone decides. */}
          <ApprovalCards
            controller={controller}
            {...(approvalViews ? { views: approvalViews } : {})}
          />
        </ConversationContent>
      </Conversation>
    </div>
  );
}

/** The message box, with a mode picker when there is more than one mode. */
export function Composer({
  placeholder,
  busy,
  disabled = false,
  modes,
  onSend,
}: {
  placeholder: string;
  busy: boolean;
  disabled?: boolean;
  modes?: ReadonlyArray<{ id: string; name: string }> | undefined;
  onSend: (text: string, mode?: string) => Promise<boolean>;
}) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState(modes?.[0]?.id);
  const blocked = busy || disabled;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || blocked) return;
    setInput('');
    // A refused message comes back to the box so nothing typed is lost.
    if (!(await onSend(text, mode))) setInput(text);
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-2xl gap-2 p-3">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        aria-label="Message"
        disabled={disabled}
        className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring disabled:opacity-60"
      />
      {modes && modes.length > 1 && (
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          aria-label="Mode"
          className="h-10 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-ring"
        >
          {modes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="submit"
        disabled={blocked || !input.trim()}
        aria-label={busy ? 'Working' : 'Send'}
        className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-[scale,opacity] enabled:active:scale-95 disabled:opacity-40"
      >
        {busy ? <SquareIcon className="size-4" /> : <SendIcon className="size-4" />}
      </button>
    </form>
  );
}
