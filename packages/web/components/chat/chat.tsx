'use client';

import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { CopyIcon, RefreshCcwIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from '@/components/ai-elements/context';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from '@/components/ai-elements/queue';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewNavigation,
  WebPreviewUrl,
} from '@/components/ai-elements/web-preview';
import { Composer, type ComposerSubmit } from '@/components/chat/composer';
import {
  GeneratedImage,
  hasWorkspaceView,
  KnowledgeSources,
  WorkspaceTool,
} from '@/components/chat/tool-views';
import { singleAgentTransport } from '@/lib/transports/single-agent';

const STARTERS = ["What's the weather in Los Angeles?", 'How do I use Mastra memory?', 'Say hello'];
const CODE_STARTERS = [
  'Create hello.js that prints the first 10 Fibonacci numbers, then run it.',
  'List the files in the workspace.',
  'Write a small TypeScript add() and a quick test, then run node on it.',
];

/** Token usage the server attaches to the assistant message metadata (→ Context). */
type TurnUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};
type TurnMetadata = { model?: string; usage?: TurnUsage };

/**
 * Single Agent chat — `useChat` over the AI SDK v6 UIMessage transport. Drives
 * both the `chat` agent and the `code` agent (sandbox workspace); the engine is
 * identical, only `agentId` and the rendered tool views differ. Uses the shared
 * <Composer> and the full AI Elements surface: message actions, sources,
 * reasoning, tools, real token usage (<Context>), a client-side send <Queue>,
 * and — for the code agent — the workspace tool calls rendered as File Tree /
 * Terminal / Code Block.
 */
export function Chat({
  agentId = 'chat',
  threadId,
  threadIsNew = false,
  onActivity,
}: {
  agentId?: string;
  /** Persisted Mastra thread to read/write (Single Agent). Omitted = ephemeral. */
  threadId?: string;
  /** True when `threadId` was freshly minted (eligible for AI title-gen). */
  threadIsNew?: boolean;
  /** Fired after each completed turn so the sidebar can refresh + re-sort. */
  onActivity?: () => void;
}) {
  const { messages, sendMessage, status, regenerate, setMessages } = useChat({
    transport: singleAgentTransport(agentId),
  });
  const isCode = agentId === 'code';

  // Send queue: submitting while a run is in flight enqueues the message; it
  // auto-sends when the run goes idle. This is what drives the <Queue> element.
  const [queue, setQueue] = useState<Array<{ id: string; submit: ComposerSubmit }>>([]);
  const draining = useRef(false);
  const idRef = useRef(0);
  const busy = status === 'submitted' || status === 'streaming';

  const send = useCallback(
    (s: ComposerSubmit) =>
      sendMessage(
        { text: s.text || 'Sent with attachments', files: s.files },
        { body: { model: s.model, webSearch: s.webSearch, threadId } },
      ),
    [sendMessage, threadId],
  );

  const handleSend = (s: ComposerSubmit) => {
    if (busy) {
      idRef.current += 1;
      setQueue((q) => [...q, { id: `q${idRef.current}`, submit: s }]);
      return;
    }
    send(s);
  };

  useEffect(() => {
    if (busy) {
      draining.current = false;
      return;
    }
    if (queue.length === 0 || draining.current) {
      return;
    }
    draining.current = true;
    const [next, ...rest] = queue;
    setQueue(rest);
    send(next.submit);
  }, [busy, queue, send]);

  // Thread switching: when the active thread changes, sync the view. A freshly
  // minted thread has nothing to load (and fetching it could race the first
  // send and wipe it), so just clear; an existing thread loads its messages.
  const loadedThread = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!threadId || threadId === loadedThread.current) {
      return;
    }
    loadedThread.current = threadId;
    if (threadIsNew) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/threads/${threadId}/messages`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { messages?: UIMessage[] }) => {
        if (!cancelled) {
          setMessages(data.messages ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, threadIsNew, setMessages]);

  // Once a thread settles (idle) with a completed exchange: refresh the sidebar
  // (new thread appears / re-sorts) and — once, only for freshly created threads
  // — kick AI title generation (Mastra's generateTitle doesn't fire through
  // handleChatStream). State-based, not edge-based, so it's robust to whichever
  // render commits the final assistant message.
  const titled = useRef<Set<string>>(new Set());
  const refreshedKey = useRef('');
  useEffect(() => {
    if (busy || !threadId) {
      return;
    }
    const assistantTurns = messages.filter((m) => m.role === 'assistant').length;
    if (assistantTurns === 0) {
      return;
    }
    // Refresh the sidebar once per completed turn (new thread + re-sort).
    const key = `${threadId}:${assistantTurns}`;
    if (refreshedKey.current !== key) {
      refreshedKey.current = key;
      onActivity?.();
    }
    // Generate a title once, only for a freshly created thread.
    if (threadIsNew && !titled.current.has(threadId)) {
      titled.current.add(threadId);
      fetch(`/api/threads/${threadId}/title`, { method: 'POST' })
        .then(() => onActivity?.())
        .catch(() => titled.current.delete(threadId));
    }
  }, [busy, threadId, threadIsNew, messages, onActivity]);

  // Latest turn's real token usage (server attaches it to message.metadata).
  const lastMeta = [...messages].reverse().find((m) => (m.metadata as TurnMetadata)?.usage)
    ?.metadata as TurnMetadata | undefined;
  const usage = lastMeta?.usage;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-1 flex-col">
      {usage && (
        <div className="flex items-center gap-3 border-border border-b px-4 py-2">
          <Context
            usedTokens={usage.totalTokens ?? 0}
            maxTokens={200_000}
            modelId={lastMeta?.model ?? 'anthropic/claude-sonnet-4-6'}
            usage={{
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              totalTokens: usage.totalTokens ?? 0,
              reasoningTokens: usage.reasoningTokens,
              cachedInputTokens: usage.cachedInputTokens,
            }}
          >
            <ContextTrigger />
            <ContextContent>
              <ContextContentHeader />
              <ContextContentBody>
                <ContextInputUsage />
                <ContextOutputUsage />
                <ContextReasoningUsage />
              </ContextContentBody>
            </ContextContent>
          </Context>
        </div>
      )}

      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="mastra-chat-kit"
              description={
                isCode
                  ? 'Code Agent · Mastra sandbox workspace · File Tree / Terminal / Code Block'
                  : 'Single Agent · AI Elements + AI SDK v6 + Mastra'
              }
            />
          ) : (
            messages.map((m) => {
              const sources = m.parts.filter(
                (p) => p.type === 'source-url' || p.type === 'source-document',
              );
              // Preview the first REAL source (web-search results); skip the
              // searchKnowledge stub's example.com placeholders.
              const previewUrl = sources
                .map((s) => (s as { url?: string }).url)
                .find((u): u is string => !!u && !u.includes('example.com'));
              return (
                <Message from={m.role} key={m.id}>
                  <MessageContent>{m.parts.map((part, i) => renderPart(part, i))}</MessageContent>

                  {sources.length > 0 && (
                    <Sources>
                      <SourcesTrigger count={sources.length} />
                      <SourcesContent>
                        {sources.map((s, i) => {
                          const url = (s as { url?: string }).url;
                          return (
                            <Source
                              key={url ?? `source-${i}`}
                              href={url ?? '#'}
                              title={(s as { title?: string }).title ?? 'Source'}
                            />
                          );
                        })}
                      </SourcesContent>
                    </Sources>
                  )}

                  {/* Web Preview: iframe the top web-search source (many sites block
                      embedding via X-Frame-Options; the URL bar lets you try another). */}
                  {previewUrl && (
                    <WebPreview defaultUrl={previewUrl} className="mt-2 h-96">
                      <WebPreviewNavigation>
                        <WebPreviewUrl />
                      </WebPreviewNavigation>
                      <WebPreviewBody />
                    </WebPreview>
                  )}

                  {m.role === 'assistant' && (
                    <MessageActions>
                      <MessageAction tooltip="Copy" label="Copy" onClick={() => copyMessage(m)}>
                        <CopyIcon className="size-4" />
                      </MessageAction>
                      <MessageAction
                        tooltip="Regenerate"
                        label="Regenerate"
                        onClick={() => regenerate()}
                      >
                        <RefreshCcwIcon className="size-4" />
                      </MessageAction>
                    </MessageActions>
                  )}
                </Message>
              );
            })
          )}

          {queue.length > 0 && (
            <Queue className="mx-2">
              <QueueSection defaultOpen>
                <QueueSectionTrigger>
                  <QueueSectionLabel count={queue.length} label="queued" />
                </QueueSectionTrigger>
                <QueueSectionContent>
                  <QueueList>
                    {queue.map((q) => (
                      <QueueItem key={q.id}>
                        <QueueItemContent>{q.submit.text}</QueueItemContent>
                      </QueueItem>
                    ))}
                  </QueueList>
                </QueueSectionContent>
              </QueueSection>
            </Queue>
          )}

          {(status === 'submitted' || status === 'streaming') && (
            <Shimmer className="px-2 text-sm">Thinking…</Shimmer>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {messages.length === 0 && (
        <Suggestions className="px-4">
          {(isCode ? CODE_STARTERS : STARTERS).map((s) => (
            <Suggestion
              key={s}
              suggestion={s}
              onClick={(t) => handleSend({ text: t, model: '', webSearch: false })}
            />
          ))}
        </Suggestions>
      )}

      <Composer onSend={handleSend} status={status} />
    </div>
  );
}

function copyMessage(m: { parts: Array<{ type: string; text?: string }> }) {
  const t = m.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');
  navigator.clipboard?.writeText(t);
}

// biome-ignore lint/suspicious/noExplicitAny: UIMessage part union isn't narrowable for tool-* parts
function renderPart(part: any, i: number) {
  if (part.type === 'text') {
    return <MessageResponse key={i}>{part.text}</MessageResponse>;
  }
  if (part.type === 'reasoning') {
    return (
      <Reasoning key={i} isStreaming={part.state === 'streaming'}>
        <ReasoningTrigger />
        <ReasoningContent>{part.text ?? ''}</ReasoningContent>
      </Reasoning>
    );
  }
  if (
    typeof part.type === 'string' &&
    (part.type.startsWith('tool-') || part.type === 'dynamic-tool')
  ) {
    const toolName = part.type === 'dynamic-tool' ? part.toolName : part.type.replace('tool-', '');

    // Code Agent: Mastra workspace tool calls → File Tree / Terminal / Code Block.
    // Only tools with a dedicated view are specialized; the rest fall through to <Tool>.
    if (hasWorkspaceView(toolName) && part.output !== undefined) {
      return <WorkspaceTool key={i} toolName={toolName} input={part.input} output={part.output} />;
    }

    // Real generateImage output → the <Image> element (fetches bytes by id).
    if (toolName === 'generateImage' && part.output?.imageId) {
      return (
        <GeneratedImage
          key={i}
          imageId={part.output.imageId}
          mediaType={part.output.mediaType}
          prompt={part.output.prompt}
        />
      );
    }
    const hasOutput = part.output !== undefined || part.errorText;
    const results = toolName === 'searchKnowledge' ? part.output?.results : undefined;
    return (
      <div className="flex flex-col gap-2" key={i}>
        <Tool>
          <ToolHeader type={part.type} state={part.state} toolName={part.toolName} />
          <ToolContent>
            <ToolInput input={part.input} />
            {hasOutput && (
              <ToolOutput
                output={
                  typeof part.output === 'string' ? (
                    part.output
                  ) : (
                    <pre className="overflow-x-auto text-xs">
                      {JSON.stringify(part.output, null, 2)}
                    </pre>
                  )
                }
                errorText={part.errorText}
              />
            )}
          </ToolContent>
        </Tool>
        {/* Real search results → Sources + InlineCitation elements. */}
        {Array.isArray(results) && <KnowledgeSources results={results} />}
      </div>
    );
  }
  return null;
}
