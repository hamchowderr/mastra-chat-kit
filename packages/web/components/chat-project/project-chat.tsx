'use client';

import { ArrowLeftIcon, SendIcon, SquareIcon } from 'lucide-react';
import { type FormEvent, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { ApprovalViews } from '@/components/chat/approval-view';
import { AskUserPrompt } from '@/components/chat/tool-views';
import { ApprovalCards, partKey, TranscriptPart } from '@/components/chat/transcript';
import {
  type UseAgentControllerChat,
  useAgentControllerChat,
} from '@/lib/agent-controller/use-agent-controller-chat';
import { type ThreadItem, useThreads } from '@/lib/agent-controller/use-threads';
import { cn } from '@/lib/utils';
import { ThreadRow, ThreadStatus, threadIdFromHref } from './thread-row';

/** How often thread statuses are re-read while one is working. */
const POLL_MS = 3000;

/**
 * A chat shaped like a project: ONE main chat, and threads it starts for pieces of work.
 *
 * The agent starts a thread with its `start_thread` tool (server: lib/work-threads.ts). The
 * thread shows up as a row under the message that started it, with its status (working,
 * needs you, done). Clicking the row opens the thread's own conversation, where you can
 * answer its approvals and questions and keep talking to it; "Main chat" goes back. When
 * a thread finishes or stops for you, a short note with a link to it lands in the main
 * chat (saved by the server, no model call).
 *
 * The main chat is the newest conversation that is not a thread. Two engines run side by
 * side, one per view, so the main chat keeps streaming while a thread is open.
 *
 *   <ProjectChat />
 */
export function ProjectChat({
  className,
  approvalViews,
  modes,
  placeholder = 'Ask anything…',
  emptyText = 'Ask for anything. Bigger pieces of work get a thread of their own.',
}: {
  className?: string;
  /** What approval cards say, per tool name (components/chat/approval-view.tsx). */
  approvalViews?: ApprovalViews | undefined;
  /**
   * Controller modes the person can pick in the main chat, first one selected. Fewer than
   * two shows no picker.
   */
  modes?: ReadonlyArray<{ id: string; name: string }> | undefined;
  placeholder?: string;
  emptyText?: string;
}) {
  const main = useAgentControllerChat();
  const thread = useAgentControllerChat();
  const { threads, refresh } = useThreads({ refreshSignal: main.refreshSignal });
  const [openId, setOpenId] = useState<string | null>(null);
  const [threadRunning, setThreadRunning] = useState(false);
  const mainId = useMainThread(main);

  const work = new Map(threads.filter((t) => t.parentThreadId).map((t) => [t.id, t]));
  const opened = openId ? work.get(openId) : undefined;
  const mainBusy = main.status === 'streaming';

  // The engines' functions are stable; the objects around them are not.
  const { openThread: openInThread } = thread;
  const { openThread: openInMain } = main;
  const open = useCallback(
    async (id: string) => {
      setOpenId(id);
      setThreadRunning((await openInThread(id)).running);
    },
    [openInThread],
  );

  // Report notes link to their thread as `#thread=<id>`; open it here instead of navigating.
  const onLinkClick = (e: MouseEvent) => {
    const id = threadIdFromHref(
      (e.target as HTMLElement).closest('a')?.getAttribute('href') ?? null,
    );
    if (!id) return;
    e.preventDefault();
    void open(id);
  };

  // While a thread is working or waiting, re-read statuses. When one changes, its report has
  // landed in the main chat (reload it unless it is mid-turn, which reloads anyway), and
  // an open thread has moved on (reload it unless it is streaming its own turn).
  const statuses = threads
    .filter((t) => t.parentThreadId)
    .map((t) => `${t.id}:${t.status}`)
    .join();
  const active = /:(working|needs_you)(,|$)/.test(statuses) || threadRunning;
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
    if (!before) return;
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

  if (openId) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col', className)}>
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 border-border border-b px-3 py-2">
          <button
            type="button"
            onClick={() => {
              setOpenId(null);
              setThreadRunning(false);
              void refresh();
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            Main chat
          </button>
          <span className="min-w-0 flex-1 truncate font-medium text-sm">
            {opened?.title ?? 'Thread'}
          </span>
          <ThreadStatus status={opened?.status} />
        </div>
        <ChatView
          controller={thread}
          approvalViews={approvalViews}
          emptyText="This thread has no messages yet."
          working={threadRunning}
          onOpenThread={open}
          onLinkClick={onLinkClick}
          work={work}
        />
        <Composer
          placeholder={threadRunning ? 'This thread is working…' : 'Reply in this thread…'}
          disabled={threadRunning}
          busy={thread.status === 'streaming'}
          onSend={(text) => thread.sendMessage(text)}
        />
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <ChatView
        controller={main}
        approvalViews={approvalViews}
        emptyText={emptyText}
        working={false}
        onOpenThread={open}
        onLinkClick={onLinkClick}
        work={work}
      />
      <Composer
        placeholder={placeholder}
        busy={mainBusy}
        modes={modes}
        onSend={(text, mode) => main.sendMessage(text, mode ? { mode } : undefined)}
      />
    </div>
  );
}

/**
 * Picks the main chat once: the newest conversation that is not a work thread, opened
 * into `main`. With none, the first message makes one, and that becomes the main chat.
 */
function useMainThread(main: UseAgentControllerChat): string | null {
  const [mainId, setMainId] = useState<string | null>(null);
  const picked = useRef(false);
  const { openThread, activeThreadId } = main;
  useEffect(() => {
    if (picked.current) return;
    picked.current = true;
    void (async () => {
      try {
        const res = await fetch('/api/agent-controller/threads', { cache: 'no-store' });
        const data = (await res.json()) as { threads?: ThreadItem[] };
        const first = (data.threads ?? []).find((t) => !t.parentThreadId && !t.archived);
        if (first) {
          setMainId(first.id);
          await openThread(first.id);
        }
      } catch {
        // No history to show; the first message starts the main chat.
      }
    })();
  }, [openThread]);
  useEffect(() => {
    if (!mainId && activeThreadId) setMainId(activeThreadId);
  }, [mainId, activeThreadId]);
  return mainId;
}

/** One conversation: its messages (with thread rows), and what it waits on. */
function ChatView({
  controller,
  approvalViews,
  emptyText,
  working,
  onOpenThread,
  onLinkClick,
  work,
}: {
  controller: UseAgentControllerChat;
  approvalViews?: ApprovalViews | undefined;
  emptyText: string;
  /** A run going on the server that this view is not streaming (a thread's own). */
  working: boolean;
  onOpenThread: (threadId: string) => void;
  onLinkClick: (e: MouseEvent) => void;
  work: Map<string, ThreadItem>;
}) {
  const { transcript, status, answerQuestion, pendingSuspension } = controller;
  const busy = status === 'streaming';
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: delegates clicks on the report links inside, which are focusable anchors already.
    <div className="min-h-0 flex-1" onClick={onLinkClick}>
      <Conversation className="h-full">
        <ConversationContent className="mx-auto w-full max-w-2xl">
          {transcript.messages.length === 0 && (
            <p className="py-12 text-center text-muted-foreground text-sm">{emptyText}</p>
          )}
          {transcript.messages.map((m) => {
            // tool_result parts arrive apart from their tool_call; pair them by id.
            const resultsById = new Map(
              m.content
                .filter((p) => p.type === 'tool_result')
                .map((p) => [
                  (p as { id: string }).id,
                  p as { result?: unknown; isError?: boolean },
                ]),
            );
            return (
              <Message key={m.id} from={m.role === 'user' ? 'user' : 'assistant'}>
                <MessageContent>
                  {m.content.map((part, i) => {
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

function Composer({
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
