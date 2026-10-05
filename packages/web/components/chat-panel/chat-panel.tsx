'use client';

import { HistoryIcon, SquarePenIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Suggestion } from '@/components/ai-elements/suggestion';
import { Composer, type ComposerSubmit } from '@/components/chat/composer';
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
  /**
   * Classes for the panel's root, e.g. its background. The panel inherits the host's
   * theme tokens (`bg-background`, `border`, fonts, radius); the header's height follows
   * the `--chat-panel-header-height` CSS variable.
   */
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
  // Archived chats stay out of the menu, as they do in the full shell's sidebar.
  const recent = threads.filter((t) => !t.archived);
  const busy = status === 'streaming';
  // Nothing to show yet. A parked approval or question is something to show, even with
  // no messages, so it is never hidden behind the greeting.
  const empty =
    transcript.messages.length === 0 &&
    !busy &&
    !transcript.pendingApproval &&
    !pendingSuspension &&
    !transcript.pendingPlan;

  // The shared composer hands over the text and any attached files (images, PDFs …).
  const handleSend = ({ text, files }: ComposerSubmit) =>
    sendMessage(text, {
      files: files?.map((f) => ({ url: f.url, mediaType: f.mediaType, filename: f.filename })),
    });
  const send = (text: string) => {
    if (text.trim() && !busy) void sendMessage(text.trim());
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)}>
      {/* Height from --chat-panel-header-height (default 3rem): a host sets it to its own
          header height so the two headers' bottom borders run on one line. */}
      <header className="flex h-[var(--chat-panel-header-height,3rem)] shrink-0 items-center gap-1 border-b px-3">
        <div className="min-w-0 flex-1 truncate font-medium text-sm">{title}</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Chat history">
              <HistoryIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
            <DropdownMenuLabel>Recent chats</DropdownMenuLabel>
            {recent.length === 0 ? (
              <p className="px-2 py-1.5 text-muted-foreground text-sm">No chats yet.</p>
            ) : (
              recent.map((t) => (
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

      {/* A failed turn says so, as the full shell does. Above the composer, so it shows on
          the empty state too (a first message can fail before any transcript exists). */}
      {transcript.error && (
        <p role="alert" className="shrink-0 px-4 pt-2 text-destructive text-sm">
          AgentController error: {transcript.error}
        </p>
      )}

      {/* The kit's shared composer: attach and dictate on the left of the send button,
          one rounded card. No model picker and no web search in a side panel. */}
      <div className="shrink-0 p-3 pt-1">
        <Composer
          onSend={handleSend}
          status={busy ? 'streaming' : status === 'error' ? 'error' : 'ready'}
          models={false}
          webSearch={false}
          placeholder={placeholder}
          className="m-0"
        />
      </div>
    </div>
  );
}
