'use client';

import { SendIcon, SquareIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { ApprovalViews } from '@/components/chat/approval-view';
import { AskUserPrompt } from '@/components/chat/tool-views';
import { ApprovalCard, partKey, TranscriptPart } from '@/components/chat/transcript';
import { useAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';
import { cn } from '@/lib/utils';

/**
 * A SECOND skin over the same Agent Controller engine (bd 23d).
 *
 * The point of this file is that it is small. It shares nothing with the full
 * `chat` shell except the engine (`useAgentControllerChat`) and the shared tool
 * renderers — no sidebar, no workbench, no model picker, its own plain composer —
 * yet it drives the identical session: same threads, same approvals, same
 * subagents, same workspace. Changing the look does not cost you the harness.
 *
 * What is NOT optional, and why: every tool is approval-gated by the controller,
 * and `ask_user` suspends the run. A skin that omits <Confirmation> or
 * <AskUserPrompt> leaves the agent parked forever with no way to continue. Layout
 * is a choice; those two are the contract.
 *
 * Drop it in anywhere — a panel, a modal, a corner of an existing app:
 *   <MinimalChat />
 */
export function MinimalChat({
  className,
  approvalViews,
}: {
  className?: string;
  /** What approval cards say, per tool name (components/chat/approval-view.tsx). */
  approvalViews?: ApprovalViews;
}) {
  const controller = useAgentControllerChat();
  const { transcript, status, sendMessage, answerQuestion, pendingSuspension } = controller;
  const [input, setInput] = useState('');

  const busy = status === 'streaming';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void sendMessage(text);
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-2xl">
          {transcript.messages.length === 0 && (
            <p className="py-12 text-center text-muted-foreground text-sm">
              Ask the agent anything.
            </p>
          )}

          {transcript.messages.map((m) => {
            // tool_result parts arrive separately from their tool_call; pair them by id
            // so a finished call renders with its output (same rule as the full shell).
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
                  {m.content.map((part, i) => (
                    <TranscriptPart
                      key={partKey(m.id, i)}
                      part={part}
                      resultsById={resultsById}
                      controller={controller}
                    />
                  ))}
                </MessageContent>
              </Message>
            );
          })}

          {busy && transcript.messages.at(-1)?.role === 'user' && (
            <Shimmer className="text-muted-foreground text-sm">Thinking…</Shimmer>
          )}

          {/* The agent asked a question; the run stays suspended until it's answered. */}
          {pendingSuspension && (
            <AskUserPrompt suspension={pendingSuspension} onAnswer={answerQuestion} />
          )}

          {/* Every tool is gated — without this the run parks forever. */}
          <ApprovalCard controller={controller} views={approvalViews} />
        </ConversationContent>
      </Conversation>

      <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-2xl gap-2 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything…"
          aria-label="Message"
          className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label={busy ? 'Working' : 'Send'}
          className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-[scale,opacity] enabled:active:scale-95 disabled:opacity-40"
        >
          {busy ? <SquareIcon className="size-4" /> : <SendIcon className="size-4" />}
        </button>
      </form>
    </div>
  );
}
