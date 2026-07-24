'use client';

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
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import {
  Queue,
  QueueList,
  QueueSection,
  QueueSectionLabel,
  QueueSectionTrigger,
} from '@/components/ai-elements/queue';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Shimmer } from '@/components/ai-elements/shimmer';
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

  const handleSend = ({ text }: ComposerSubmit) => sendMessage(text);

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
            <ConversationEmptyState
              title="mastra-chat-kit"
              description="Agent Harness · sessions · modes · approvals · subagents · tasks"
            />
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
                  <Message from={m.role} key={m.id}>
                    <MessageContent>
                      {steps.length > 0 && <StepTrace steps={steps} />}
                      {m.content.map((part, i) => renderContent(part, i, resultsById))}
                    </MessageContent>
                  </Message>
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

          {/* Real streaming indicator while the run is in flight. */}
          {status === 'streaming' && <Shimmer className="px-2 text-sm">Thinking…</Shimmer>}

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
