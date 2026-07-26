'use client';

import { BotIcon, CopyIcon, UserIcon } from 'lucide-react';
import { Agent, AgentContent, AgentHeader } from '@/components/ai-elements/agent';
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
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Suggestion } from '@/components/ai-elements/suggestion';
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
  GoalCard,
  type KnowledgeResult,
  KnowledgeSources,
  PlanCard,
  StepTrace,
} from '@/components/chat/tool-views';
import {
  collectToolResults,
  type HarnessContentPart,
  type SubagentRun,
} from '@/lib/harness/events';
import type { UseHarnessChat } from '@/lib/harness/use-harness-chat';
import { cn } from '@/lib/utils';

/**
 * Empty-state suggestion pills — a short label the user sees, and the fuller `prompt`
 * actually sent on click (so the pills read evenly while still exercising real tools).
 */
const STARTERS: { label: string; prompt: string }[] = [
  { label: 'Weather in LA', prompt: "What's the weather in Los Angeles?" },
  {
    label: 'Fibonacci demo',
    prompt: 'Create hello.js that prints the first 10 Fibonacci numbers, then run it.',
  },
  { label: 'List workspace files', prompt: 'List the files in the workspace.' },
  { label: 'Latest Mastra release', prompt: 'Search the web for the latest Mastra release notes.' },
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
      {isUser ? <UserIcon className="size-3.5" /> : <BotIcon className="size-3.5" />}
    </div>
  );
}

/** Bot avatar + three bouncing dots — shown before the assistant reply streams. */
function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3">
      {/* biome-ignore lint/a11y/useValidAriaRole: `role` is MsgAvatar's message-role prop, not an ARIA role */}
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
export function HarnessChat({ harness }: { harness: UseHarnessChat }) {
  const { transcript, status, sendMessage, approve } = harness;
  // Goals AND planning are agent-driven — the agent calls its own `setGoal` tool for a
  // standing objective and the built-in `submit_plan` for tasks that warrant a plan, so
  // there are no manual mode/goal controls in the composer. `clearGoal` backs the goal
  // card's dismiss affordance (the user can abandon an active goal).
  const { goal, clearGoal } = harness;
  const { messages, tasks, pendingApproval, usage, info, subagents, error } = transcript;
  const resultsById = collectToolResults(messages);
  // Subagent runs keyed by the parent `subagent` tool-call id, so a `subagent`
  // tool call in the transcript renders as the nested <Agent> card.
  const subagentsById = new Map(subagents.map((r) => [r.toolCallId, r]));

  const handleSend = ({ text, model, webSearch, files }: ComposerSubmit) =>
    sendMessage(text, {
      model,
      webSearch,
      files: files?.map((f) => ({ url: f.url, mediaType: f.mediaType, filename: f.filename })),
    });

  // Live token usage lives INSIDE the composer footer (not floating in the chat).
  const contextSlot = usage ? (
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
  ) : null;

  // White composer so it pops against the zinc canvas. Rendered under the hero on the
  // empty state, or pinned at the bottom once the chat is going. The token-usage Context
  // rides in its footer. No composer controls for modes/goals — those are agent-driven.
  const composer = (
    <Composer
      onSend={handleSend}
      status={status === 'streaming' ? 'streaming' : status === 'error' ? 'error' : 'ready'}
      className="m-0 [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:bg-card [&_[data-slot=input-group]]:shadow-[var(--shadow-float)]"
      footerExtra={contextSlot}
    />
  );

  // Suggestion pills → a fuller prompt on click. Reused in the empty state above the composer.
  const starterPills = (
    <div className="flex w-full max-w-3xl flex-wrap items-center justify-center gap-2">
      {STARTERS.map((s) => (
        <Suggestion
          key={s.prompt}
          suggestion={s.prompt}
          onClick={(prompt) => handleSend({ text: prompt, model: '', webSearch: false })}
          className="animate-fade-up"
        >
          {s.label}
        </Suggestion>
      ))}
    </div>
  );

  return (
    // Flat chat pane. NO h-full here — an explicit height opts the flex item out of
    // align-stretch and then collapses to content height; letting it stretch to the
    // row is what actually fills the column. min-h-0 lets the conversation scroll.
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      {messages.length === 0 && status !== 'streaming' ? (
        // Empty state: hero + suggestion pills + composer, centered as one group. The pills
        // sit ABOVE the composer so they read as prompts leading into the input.
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
          <div className="animate-fade-up space-y-2 text-center">
            <h1 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
              What&rsquo;s on your mind today?
            </h1>
            <p className="text-base text-muted-foreground">
              Ask a question, run some code, or browse the web.
            </p>
          </div>
          {starterPills}
          <div className="w-full max-w-3xl">{composer}</div>
          {goal && (
            <div className="w-full max-w-3xl">
              <GoalCard goal={goal} onClear={clearGoal} />
            </div>
          )}
        </div>
      ) : (
        <Conversation className="flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl pt-10">
            {/* Goal card pinned above the conversation — the live judge verdict for the
                active objective (updates as goal_evaluation events stream in). */}
            {goal && <GoalCard goal={goal} onClear={clearGoal} />}
            {messages
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
                        {m.content.map((part, i) =>
                          renderContent(part, i, resultsById, subagentsById),
                        )}
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
              })}

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
              <Confirmation
                state="approval-requested"
                approval={{ id: pendingApproval.toolCallId }}
              >
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

            {/* Transient run status (harness `info` events). */}
            {info && !error && <p className="px-2 text-muted-foreground text-xs italic">{info}</p>}

            {error && <p className="px-2 text-destructive text-sm">Harness error: {error}</p>}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      {/* Bottom composer only once a chat is going — the empty state has its own
          centered one, so it never shows twice. */}
      {!(messages.length === 0 && status !== 'streaming') && (
        <div className="mx-auto w-full max-w-3xl px-4 pb-4">{composer}</div>
      )}
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

/**
 * A subagent invocation → the <Agent> card: header (type + model + forked badge),
 * the delegated task, the subagent's nested tool calls, its streamed text, and a
 * live/`done`/error footer. Driven by the accumulated `subagent_*` events; falls
 * back to the parent tool-call `task` before any subagent event arrives.
 */
function SubagentCard({ run, fallbackTask }: { run?: SubagentRun; fallbackTask?: string }) {
  const agentType = run?.agentType ?? 'subagent';
  const task = run?.task ?? fallbackTask;
  const running = run?.status !== 'done';
  return (
    <Agent className="my-2 rounded-lg">
      <AgentHeader
        name={`Subagent · ${agentType}${run?.forked ? ' (forked)' : ''}`}
        model={run?.modelId}
      />
      <AgentContent className="pt-3">
        {task && <p className="text-muted-foreground text-xs">Task: {task}</p>}
        {run?.tools.map((t, ti) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: tool list is append-only, never reordered
          <Tool key={`${t.name}-${ti}`}>
            <ToolHeader
              type={`tool-${t.name}`}
              state={t.result !== undefined ? 'output-available' : 'input-available'}
            />
            <ToolContent>
              <ToolInput input={t.args} />
              {t.result !== undefined && (
                <ToolOutput
                  output={
                    <pre className="overflow-x-auto text-xs">
                      {JSON.stringify(t.result, null, 2)}
                    </pre>
                  }
                  errorText={t.isError ? 'Tool reported an error' : undefined}
                />
              )}
            </ToolContent>
          </Tool>
        ))}
        {run?.text && <MessageResponse>{run.text}</MessageResponse>}
        {running ? (
          <p className="animate-pulse text-muted-foreground text-xs italic">Working…</p>
        ) : run?.isError ? (
          <p className="text-destructive text-xs">Subagent reported an error.</p>
        ) : null}
      </AgentContent>
    </Agent>
  );
}

function renderContent(
  part: HarnessContentPart,
  i: number,
  resultsById: Map<string, HarnessContentPart>,
  subagentsById: Map<string, SubagentRun>,
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

    // The agent's `setGoal` tool has no inline rendering — the GoalCard (pinned above
    // the conversation, driven by goal_evaluation) is its surface, so suppress the raw call.
    if (call.name === 'setGoal') {
      return null;
    }
    // The built-in `subagent` tool → the nested <Agent> card, driven by the
    // subagent_* events accumulated for this tool-call id.
    if (call.name === 'subagent') {
      const run = subagentsById.get(call.id);
      const task = (call.args as { task?: string } | undefined)?.task;
      return <SubagentCard key={i} run={run} fallbackTask={task} />;
    }
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
