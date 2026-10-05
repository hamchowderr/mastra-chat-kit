'use client';

import { ArrowUpIcon, HistoryIcon, LoaderIcon, SquarePenIcon } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from 'react';
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Suggestion } from '@/components/ai-elements/suggestion';
import { AskUserPrompt } from '@/components/chat/tool-views';
import { ApprovalCard, partKey, TranscriptPart } from '@/components/chat/transcript';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';
import { useThreads } from '@/lib/agent-controller/use-threads';
import { cn } from '@/lib/utils';

export type ChatPanelSuggestion = { label: string; prompt: string };

export type ChatPanelProps = {
  /** The header title. */
  title?: ReactNode;
  /** The empty state's heading and the line under it. */
  greeting?: { title: ReactNode; description?: ReactNode };
  /** Empty-state prompts: a short label and the prompt it sends. */
  suggestions?: ChatPanelSuggestion[];
  /** The composer's placeholder. */
  placeholder?: string;
  /** Host buttons at the right of the header (full screen, close, …). */
  actions?: ReactNode;
  className?: string;
};

/**
 * A THIRD skin over the same Agent Controller engine: a side panel, the shape of a
 * browser's assistant side panel. A header (title, conversation history, new chat,
 * and the host's own buttons), the conversation — or a greeting and suggestions when
 * it is empty — and a rounded composer card at the bottom.
 *
 * Same session and threads as the full `chat` shell: open a conversation here and it
 * is in the full shell's sidebar, and the other way round. Approvals, `ask_user` and
 * submitted plans render through the shared transcript pieces, so the agent never
 * parks with no way to continue. No model picker: every turn runs on the server's
 * CHAT_MODEL.
 *
 *   <ChatPanel title="Assistant" suggestions={[…]} actions={<CloseButton />} />
 */
export function ChatPanel({
  title = 'Chat',
  greeting = { title: 'How can I help you today?' },
  suggestions = [],
  placeholder = 'How can I help you today?',
  actions,
  className,
}: ChatPanelProps) {
  const controller = useAgentControllerChat();
  const { transcript, status, sendMessage, answerQuestion, pendingSuspension } = controller;
  const { threads } = useThreads({ refreshSignal: controller.refreshSignal });
  const [input, setInput] = useState('');

  const busy = status === 'streaming';
  const empty = transcript.messages.length === 0 && !busy;

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput('');
    void sendMessage(t);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };
  // Enter sends; Shift+Enter (or composing an IME character) adds a line.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)}>
      <header className="flex h-12 shrink-0 items-center gap-1 px-3">
        <div className="min-w-0 flex-1 truncate font-medium text-sm">{title}</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Chat history">
              <HistoryIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
            <DropdownMenuLabel>Recent chats</DropdownMenuLabel>
            {threads.length === 0 ? (
              <p className="px-2 py-1.5 text-muted-foreground text-sm">No chats yet.</p>
            ) : (
              threads
                .filter((t) => !t.archived)
                .map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onSelect={() => void controller.openThread(t.id)}
                    className={cn(t.id === controller.activeThreadId && 'bg-accent')}
                  >
                    <span className="truncate">{t.title}</span>
                  </DropdownMenuItem>
                ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="New chat"
          onClick={() => controller.reset()}
        >
          <SquarePenIcon className="size-4" />
        </Button>
        {actions}
      </header>

      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6 text-center">
          <div className="space-y-1.5">
            <h2 className="text-balance font-semibold text-xl tracking-tight">{greeting.title}</h2>
            {greeting.description && (
              <p className="text-balance text-muted-foreground text-sm">{greeting.description}</p>
            )}
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <Suggestion key={s.prompt} suggestion={s.prompt} onClick={send}>
                  {s.label}
                </Suggestion>
              ))}
            </div>
          )}
        </div>
      ) : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="px-4">
            {transcript.messages
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => {
                // tool_result parts arrive separately from their tool_call; pair them by id.
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
            <ApprovalCard controller={controller} />
          </ConversationContent>
        </Conversation>
      )}

      <form onSubmit={onSubmit} className="shrink-0 p-3 pt-1">
        <div className="flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-xs transition-colors focus-within:border-ring">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label="Message"
            rows={1}
            // 16px on phones so iOS doesn't zoom into the field; grows with the text.
            className="field-sizing-content max-h-48 min-h-6 w-full resize-none bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
          />
          <div className="flex items-center justify-end">
            <Button
              type="submit"
              size="icon"
              className="size-8 rounded-full"
              disabled={busy || !input.trim()}
              aria-label={busy ? 'Working' : 'Send'}
            >
              {busy ? (
                <LoaderIcon className="size-4 animate-spin" />
              ) : (
                <ArrowUpIcon className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
