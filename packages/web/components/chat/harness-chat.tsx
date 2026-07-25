'use client';

import { CopyIcon, SparklesIcon, UserIcon } from 'lucide-react';
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from '@/components/ai-elements/confirmation';
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
  QueueList,
  QueueSection,
  QueueSectionLabel,
  QueueSectionTrigger,
} from '@/components/ai-elements/queue';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { Composer, type ComposerSubmit } from '@/components/chat/composer';
import {
  GeneratedImage,
  type KnowledgeResult,
  KnowledgeSources,
  PlanCard,
  StepTrace,
} from '@/components/chat/tool-views';
import { collectToolResults, type HarnessContentPart } from '@/lib/harness/events';
import type { UseHarnessChat } from '@/lib/harness/use-harness-chat';
import { cn } from '@/lib/utils';

/** Empty-state suggestion chips — exercise the agent's real toolset. */
const STARTERS = [
  "What's the weather in Los Angeles?",
  'Create hello.js that prints the first 10 Fibonacci numbers, then run it.',
  'List the files in the workspace.',
  'Search the web for the latest Mastra release notes.',
];

/** Round avatar next to each message: user (filled brand) / assistant (bot). */
function MsgAvatar({ role }: { role: string }) {
  const isUser = role === 'user';
  return (
    <div
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full',
        isUser
          ? 'bg-primary text-primary-foreground'
          : 'border border-border bg-card text-muted-foreground',
      )}
    >
      {isUser ? <UserIcon className="size-3.5" /> : <SparklesIcon className="size-3.5" />}
    </div>
  );
}

/** Bot avatar + three bouncing dots — shown before the assistant reply streams. */
function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3">
      <MsgAvatar role="assistant" />
      <span className="flex items-center gap-1" aria-label="Assistant is responding" role="status">
        <span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
        <span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
        <span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
      </span>
    </div>
  );
}

/**
 * Agent Harness chat — consumes the Harness SSE (`useHarnessChat`) and renders its
 * richer surface on the SAME AI Elements as the Single Agent <Chat>: text, thinking
 * → Reasoning, tool calls → Tool, search results → Sources/InlineCitation, images →
 * Image, submit_plan → Plan, the step sequence → ChainOfThought, task_updated → Task,
 * approvals → Confirmation. Only the engine behind the shared <Composer> differs.
 */
export function HarnessChat({
  harness,
  fluid = false,
}: {
  harness: UseHarnessChat;
  fluid?: boolean;
}) {
  const { transcript, status, sendMessage, approve } = harness;
  const { messages, tasks, pendingApproval, usage, queuedFollowUps, error } = transcript;
  const resultsById = collectToolResults(messages);

  const handleSend = ({ text, model, webSearch, files }: ComposerSubmit) =>
    sendMessage(text, {
      model,
      webSearch,
      files: files?.map((f) => ({ url: f.url, mediaType: f.mediaType, filename: f.filename })),
    });

  return (
    // `fluid` fills the column when the workbench panel is open; otherwise the
    // chat keeps a comfortable centered reading width.
    <div
      className={cn(
        'flex h-full w-full flex-1 flex-col',
        fluid ? 'max-w-none' : 'mx-auto max-w-3xl',
      )}
    >
      {/* Live session state: real token usage (Context) + queued follow-ups (Queue). */}
      {(usage || queuedFollowUps > 0) && (
        <div className="flex items-center gap-3 border-border border-b px-4 py-2">
          {usage && (
            <Context
              usedTokens={usage.totalTokens ?? 0}
              maxTokens={200_000}
              modelId="anthropic/claude-haiku-4-5"
              usage={{
                inputTokens: usage.promptTokens ?? 0,
                outputTokens: usage.completionTokens ?? 0,
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
          )}
          {queuedFollowUps > 0 && (
            <Queue>
              <QueueSection defaultOpen>
                <QueueSectionTrigger>
                  <QueueSectionLabel count={queuedFollowUps} label="queued" />
                </QueueSectionTrigger>
                <QueueList />
              </QueueSection>
            </Queue>
          )}
        </div>
      )}
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-8 px-4 text-center">
              <div className="animate-fade-up space-y-2">
                <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">
                  What can I help with?
                </h1>
                <p className="text-base text-muted-foreground">
                  Ask a question, run some code, or browse the web.
                </p>
              </div>
              <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleSend({ text: s, model: '', webSearch: false })}
                    className="animate-fade-up rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-left text-muted-foreground text-sm transition-colors hover:border-border hover:bg-accent hover:text-accent-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => {
                // The agent's actual tool-call sequence → a ChainOfThought trace.
                const steps =
                  m.role === 'assistant'
                    ? m.content
                        .filter((p) => p.type === 'tool_call')
                        .map((p) => `Called ${(p as { name: string }).name}`)
                    : [];
                return (
                  <div
                    key={m.id}
                    className={cn(
                      'flex w-full items-start gap-3',
                      m.role === 'user' && 'flex-row-reverse',
                    )}
                  >
                    <MsgAvatar role={m.role} />
                    <Message from={m.role} className="min-w-0 max-w-[85%] flex-1">
                      <MessageContent>
                        {steps.length > 0 && <StepTrace steps={steps} />}
                        {m.content.map((part, i) => renderContent(part, i, resultsById))}
                      </MessageContent>
                      {m.role === 'assistant' && (
                        <MessageActions>
                          <MessageAction
                            tooltip="Copy"
                            label="Copy"
                            onClick={() => copyHarnessMessage(m.content)}
                          >
                            <CopyIcon className="size-4" />
                          </MessageAction>
                        </MessageActions>
                      )}
                    </Message>
                  </div>
                );
              })
          )}

          {tasks.length > 0 && (
            <Task defaultOpen>
              <TaskTrigger title={`Tasks (${tasks.length})`} />
              <TaskContent>
                {tasks.map((t, i) => (
                  <TaskItem key={t.id ?? `task-${i}`}>
                    {t.status ? `[${t.status}] ` : ''}
                    {t.content ?? t.title ?? 'Task'}
                  </TaskItem>
                ))}
              </TaskContent>
            </Task>
          )}

          {pendingApproval && (
            <Confirmation state="approval-requested" approval={{ id: pendingApproval.toolCallId }}>
              <ConfirmationTitle>Run {pendingApproval.toolName}?</ConfirmationTitle>
              <ConfirmationRequest>
                <pre className="overflow-x-auto text-xs">
                  {JSON.stringify(pendingApproval.args, null, 2)}
                </pre>
                <ConfirmationActions>
                  <ConfirmationAction onClick={() => approve('approve')}>
                    Approve
                  </ConfirmationAction>
                  <ConfirmationAction variant="outline" onClick={() => approve('decline')}>
                    Reject
                  </ConfirmationAction>
                </ConfirmationActions>
              </ConfirmationRequest>
            </Confirmation>
          )}

          {/* Bot avatar + typing dots while the run is in flight and the assistant
              hasn't started its reply yet (otherwise the reply itself is the signal). */}
          {status === 'streaming' &&
            messages.filter((m) => m.role === 'user' || m.role === 'assistant').at(-1)?.role !==
              'assistant' && <ThinkingIndicator />}

          {error && <p className="px-2 text-destructive text-sm">Harness error: {error}</p>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <Composer
        onSend={handleSend}
        status={status === 'streaming' ? 'streaming' : status === 'error' ? 'error' : 'ready'}
      />
    </div>
  );
}

/** Copy the plain text of a harness assistant turn (text parts only). */
function copyHarnessMessage(content: HarnessContentPart[]) {
  const text = content
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text ?? '')
    .join('\n');
  navigator.clipboard?.writeText(text);
}

function renderContent(
  part: HarnessContentPart,
  i: number,
  resultsById: Map<string, HarnessContentPart>,
) {
  if (part.type === 'text') {
    return <MessageResponse key={i}>{(part as { text: string }).text}</MessageResponse>;
  }
  if (part.type === 'thinking') {
    return (
      <Reasoning key={i} defaultOpen={false}>
        <ReasoningTrigger />
        <ReasoningContent>{(part as { thinking: string }).thinking}</ReasoningContent>
      </Reasoning>
    );
  }
  if (part.type === 'tool_call') {
    const call = part as { id: string; name: string; args: unknown };
    const result = resultsById.get(call.id) as { result?: unknown; isError?: boolean } | undefined;
    const output = result?.result;

    // submit_plan → the <Plan> element.
    if (call.name === 'submit_plan') {
      const a = call.args as { title?: string; plan?: string };
      return <PlanCard key={i} title={a?.title} plan={a?.plan ?? ''} />;
    }
    // generateImage → the <Image> element (fetches bytes by id).
    const img = output as { imageId?: string; mediaType?: string; prompt?: string } | undefined;
    if (call.name === 'generateImage' && img?.imageId) {
      return (
        <GeneratedImage
          key={i}
          imageId={img.imageId}
          mediaType={img.mediaType ?? 'image/webp'}
          prompt={img.prompt}
        />
      );
    }

    const hasOutput = result !== undefined;
    const searchResults =
      call.name === 'searchKnowledge'
        ? (output as { results?: KnowledgeResult[] } | undefined)?.results
        : undefined;
    return (
      <div className="flex flex-col gap-2" key={i}>
        <Tool>
          <ToolHeader
            type={`tool-${call.name}`}
            state={hasOutput ? 'output-available' : 'input-available'}
          />
          <ToolContent>
            <ToolInput input={call.args} />
            {hasOutput && (
              <ToolOutput
                output={
                  <pre className="overflow-x-auto text-xs">
                    {JSON.stringify(result?.result, null, 2)}
                  </pre>
                }
                errorText={result?.isError ? 'Tool reported an error' : undefined}
              />
            )}
          </ToolContent>
        </Tool>
        {Array.isArray(searchResults) && <KnowledgeSources results={searchResults} />}
      </div>
    );
  }
  // tool_result is rendered alongside its tool_call; skip standalone.
  if (part.type === 'tool_result') {
    return null;
  }
  if (part.type === 'system_reminder') {
    return (
      <p className="text-muted-foreground text-xs" key={i}>
        {(part as { message: string }).message}
      </p>
    );
  }
  return null;
}
