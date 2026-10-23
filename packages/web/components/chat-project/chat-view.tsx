'use client';

import { Fragment, type MouseEvent, useMemo } from 'react';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { ApprovalViews } from '@/components/chat/approval-view';
import {
  messagePieces,
  ToolStepList,
  type ToolViews,
  withPlainSteps,
} from '@/components/chat/tool-steps';
import { AskUserPrompt, GoalCard } from '@/components/chat/tool-views';
import { ApprovalCards, partKey, TranscriptPart } from '@/components/chat/transcript';
import { CopyTurn, QueuedFollowUps, SubagentCard } from '@/components/chat/turn-extras';
import type { UseAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';
import type { ThreadItem } from '@/lib/agent-controller/use-threads';
import type { ThreadOutput } from './thread-groups';
import { ThreadRow } from './thread-row';
import {
  chatThreads,
  offered,
  startedAfter,
  suggestionsOf,
  ThreadSuggestions,
} from './thread-suggestions';

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
  outputsOf,
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
  /** What each thread made, shown beside its row (see `ProjectChat`). */
  outputsOf?: ((t: ThreadItem) => ThreadOutput[]) | undefined;
}) {
  const { transcript, status, answerQuestion, pendingSuspension, goal, clearGoal } = controller;
  const subagentsById = useMemo(
    () => new Map(transcript.subagents.map((r) => [r.toolCallId, r])),
    [transcript.subagents],
  );
  const busy = status === 'streaming';
  const views = useMemo(() => withPlainSteps(toolViews), [toolViews]);
  const lastAssistant = transcript.messages.findLastIndex((m) => m.role !== 'user');
  // The threads this chat started, by title: a suggestion with one shows it, not Start.
  const madeHere = useMemo(() => chatThreads(transcript.messages), [transcript.messages]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: delegates clicks on the report links inside, which are focusable anchors already.
    <div className="min-h-0 flex-1" onClick={onLinkClick}>
      <Conversation className="h-full">
        <ConversationContent className="mx-auto w-full max-w-3xl pt-10">
          {/* The standing objective the agent set itself, with its latest verdict. */}
          {goal && <GoalCard goal={goal} onClear={clearGoal} />}
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
                    if (call.type === 'tool_call' && call.name === 'subagent') {
                      return (
                        <SubagentCard
                          key={partKey(m.id, i)}
                          run={subagentsById.get(call.id ?? '')}
                          fallbackTask={(call.args as { task?: string } | undefined)?.task}
                        />
                      );
                    }
                    if (call.type === 'tool_call' && call.name === 'suggest_threads') {
                      // Drawn once the tool accepted it: a refused call offered nothing.
                      const result = resultsById.get(call.id ?? '');
                      if (result?.isError || !offered(result?.result)) return null;
                      return (
                        <ThreadSuggestions
                          key={partKey(m.id, i)}
                          suggestions={suggestionsOf(call.args)}
                          startedOf={(title) => {
                            const thread = startedAfter(madeHere, at, title);
                            return thread
                              ? {
                                  threadId: thread.threadId,
                                  status: work.get(thread.threadId)?.status,
                                }
                              : undefined;
                          }}
                          onStart={(text) => void controller.sendMessage(text)}
                          onOpen={onOpenThread}
                          disabled={busy || Boolean(pendingSuspension)}
                        />
                      );
                    }
                    if (call.type === 'tool_call' && call.name === 'start_thread') {
                      const result = resultsById.get(call.id ?? '')?.result as
                        | { threadId?: string; title?: string }
                        | undefined;
                      const title =
                        result?.title ?? (call.args as { title?: string } | undefined)?.title ?? '';
                      const started = result?.threadId ? work.get(result.threadId) : undefined;
                      return (
                        <ThreadRow
                          key={partKey(m.id, i)}
                          title={title}
                          threadId={result?.threadId}
                          status={result?.threadId ? work.get(result.threadId)?.status : undefined}
                          open={Boolean(result?.threadId) && result?.threadId === openThreadId}
                          onOpen={onOpenThread}
                          outputs={started ? outputsOf?.(started) : undefined}
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
                {/* Copy once the reply is done; a turn still streaming has more to come. */}
                {m.role !== 'user' && !live && <CopyTurn content={m.content} />}
              </Message>
            );
          })}

          {((busy && transcript.messages.at(-1)?.role === 'user') || working) && (
            <Shimmer className="text-muted-foreground text-sm">
              {working ? 'Working…' : 'Thinking…'}
            </Shimmer>
          )}

          <QueuedFollowUps count={transcript.queuedFollowUps} />

          {/* Transient run status (controller `info` events). */}
          {transcript.info && !transcript.error && (
            <p className="text-muted-foreground text-xs italic">{transcript.info}</p>
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
        <ConversationScrollButton />
      </Conversation>
    </div>
  );
}
