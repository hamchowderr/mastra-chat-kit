'use client';

import { BotIcon, UserIcon } from 'lucide-react';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Suggestion } from '@/components/ai-elements/suggestion';
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import type { ApprovalViews } from '@/components/chat/approval-view';
import { ChatMarkdown } from '@/components/chat/chat-markdown';
import { Composer, type ComposerSubmit, type ModelOption } from '@/components/chat/composer';
import { PlanModeToggle, usePlanMode } from '@/components/chat/plan-mode';
import {
  AskUserPrompt,
  GeneratedImage,
  GoalCard,
  type KnowledgeResult,
  KnowledgeSources,
  StepTrace,
} from '@/components/chat/tool-views';
import { ApprovalCards, SubmittedPlanCard } from '@/components/chat/transcript';
import {
  CopyTurn,
  QueuedFollowUps,
  SubagentCard,
  UsageContext,
} from '@/components/chat/turn-extras';
import {
  type ActiveTool,
  type AgentControllerContentPart,
  collectToolResults,
  type PendingPlan,
  type SubagentRun,
} from '@/lib/agent-controller/events';
import type { UseAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';
import { cn } from '@/lib/utils';

/**
 * Empty-state suggestion pills — a short label the user sees, and the fuller `prompt`
 * actually sent on click (so the pills read evenly while still exercising real tools).
 */
/** An empty-state suggestion: a short label, and the prompt it sends. */
export type ChatSuggestion = { label: string; prompt: string };

/**
 * What a host can change about the chat without forking it. Every field is optional and
 * defaults to the kit's own demo setup.
 */
export type ChatOptions = {
  /** The empty-state suggestion pills. `[]` shows none. */
  suggestions?: ChatSuggestion[];
  /** The composer's model picker. `false` hides it (the server's CHAT_MODEL is used). */
  models?: ModelOption[] | false;
  /** Show the composer's "Search the web" toggle. */
  webSearch?: boolean;
  /** The empty-state heading and line under it. */
  greeting?: { title: string; description?: string };
  /**
   * What approval cards say, per tool name (components/chat/approval-view.tsx). Tools
   * without one get their name in words and their arguments as fields.
   */
  approvalViews?: ApprovalViews;
};

const STARTERS: ChatSuggestion[] = [
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
/**
 * Shown between `agent_start` and the first assistant token. The event map
 * documents `agent_start` → the Shimmer element, so this renders Shimmer rather
 * than hand-rolled dots — otherwise /events claims a mapping the UI never uses.
 */
function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3">
      {/* biome-ignore lint/a11y/useValidAriaRole: `role` is MsgAvatar's message-role prop, not an ARIA role */}
      <MsgAvatar role="assistant" />
      <span aria-label="Assistant is responding" role="status">
        <Shimmer className="text-muted-foreground text-sm">Thinking…</Shimmer>
      </span>
    </div>
  );
}

/**
 * Agent Controller chat — consumes the AgentController SSE (`useAgentControllerChat`) and renders its
 * full surface onto stock AI Elements: text, thinking
 * → Reasoning, tool calls → Tool, search results → Sources/InlineCitation, images →
 * Image, submit_plan → Plan, the step sequence → ChainOfThought, task_updated → Task,
 * approvals → Confirmation. Only the engine behind the shared <Composer> differs.
 */
export function AgentControllerChat({
  controller,
  options = {},
}: {
  controller: UseAgentControllerChat;
  options?: ChatOptions;
}) {
  const suggestions = options.suggestions ?? STARTERS;
  const greeting = options.greeting ?? {
    title: 'What’s on your mind today?',
    description: 'Ask a question, run some code, or browse the web.',
  };
  const { transcript, status, sendMessage, answerQuestion } = controller;
  // Goals are agent-driven — the agent calls its own `setGoal` tool for a standing
  // objective, so there's no goal control; `clearGoal` backs the goal card's dismiss.
  const { goal, clearGoal } = controller;
  // Planning is agent-driven too (the agent can call `submit_plan` from Chat), but the
  // composer's Plan toggle starts a turn in Plan mode to ask for one. Approving the plan
  // switches the session back to Chat — `mode_changed` — so the toggle follows it off.
  const { pendingPlan, activeMode, respondToPlan } = controller;
  const plan = usePlanMode(activeMode);
  const planView: PlanView = { pendingPlan, activeMode, respondToPlan };
  const {
    messages,
    tasks,
    pendingSuspension,
    usage,
    info,
    subagents,
    activeTools,
    error,
    queuedFollowUps,
  } = transcript;
  const resultsById = collectToolResults(messages);
  // Subagent runs keyed by the parent `subagent` tool-call id, so a `subagent`
  // tool call in the transcript renders as the nested <Agent> card.
  const subagentsById = new Map(subagents.map((r) => [r.toolCallId, r]));

  const handleSend = ({ text, model, webSearch, files }: ComposerSubmit) =>
    sendMessage(text, {
      model,
      webSearch,
      mode: plan.mode,
      files: files?.map((f) => ({ url: f.url, mediaType: f.mediaType, filename: f.filename })),
    });

  // Live token usage lives INSIDE the composer footer (not floating in the chat).
  const contextSlot = <UsageContext usage={usage} />;

  // White composer so it pops against the zinc canvas. Rendered under the hero on the
  // empty state, or pinned at the bottom once the chat is going. The token-usage Context
  // rides in its footer; the Plan toggle leads its tools row.
  const composer = (
    <Composer
      onSend={handleSend}
      toolsExtra={<PlanModeToggle on={plan.on} onToggle={plan.toggle} />}
      status={status === 'streaming' ? 'streaming' : status === 'error' ? 'error' : 'ready'}
      className="m-0 [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:bg-card [&_[data-slot=input-group]]:shadow-[var(--shadow-float)]"
      footerExtra={contextSlot}
      models={options.models}
      webSearch={options.webSearch ?? true}
    />
  );

  // Suggestion pills → a fuller prompt on click. Reused in the empty state above the composer.
  const starterPills = suggestions.length ? (
    <div className="flex w-full max-w-3xl flex-wrap items-center justify-center gap-2">
      {suggestions.map((s) => (
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
  ) : null;

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
              {greeting.title}
            </h1>
            {greeting.description && (
              <p className="text-base text-muted-foreground">{greeting.description}</p>
            )}
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
                          renderContent(part, i, resultsById, subagentsById, planView),
                        )}
                      </MessageContent>
                      {m.role === 'assistant' && <CopyTurn content={m.content} />}
                    </Message>
                  </div>
                );
              })}

            {/* Live tool calls whose input is still streaming — shown until the settled
                message part lands and suppresses them (698.25). No double-render: the
                reducer drops an active entry the moment its tool_call message part exists. */}
            {activeTools.map((t) => (
              <ActiveToolCard key={`active-${t.toolCallId}`} tool={t} />
            ))}

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

            <ApprovalCards controller={controller} views={options.approvalViews} />

            {/* Agent-driven ask_user: the run is suspended awaiting the user's answer
                to a clarifying question. Answering resumes it on the open SSE. */}
            {pendingSuspension && (
              <AskUserPrompt suspension={pendingSuspension} onAnswer={answerQuestion} />
            )}

            {/* Bot avatar + typing dots while the run is in flight and the assistant
              hasn't started its reply yet (otherwise the reply itself is the signal). */}
            {status === 'streaming' &&
              messages.filter((m) => m.role === 'user' || m.role === 'assistant').at(-1)?.role !==
                'assistant' && <ThinkingIndicator />}

            {/* Messages sent while a run was busy are queued server-side and replayed
                when it settles (`follow_up_queued`). Without this the count is folded
                into state and never shown, so the user gets no sign they landed. */}
            <QueuedFollowUps count={queuedFollowUps} />

            {/* Transient run status (controller `info` events). */}
            {info && !error && <p className="px-2 text-muted-foreground text-xs italic">{info}</p>}

            {error && (
              <p className="px-2 text-destructive text-sm">AgentController error: {error}</p>
            )}
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

/**
 * A tool call whose input is still streaming — rendered from an `activeTools` entry
 * during the window before the settled `message_update` tool-invocation part arrives
 * (which then suppresses this via the reducer). Shows the input-streaming <Tool> state
 * with whatever args have streamed so far (best-effort parse of the partial JSON).
 */
function ActiveToolCard({ tool }: { tool: ActiveTool }) {
  let input: unknown = tool.argsText;
  try {
    if (tool.argsText.trim()) {
      input = JSON.parse(tool.argsText);
    }
  } catch {
    // Partial/streaming JSON — show the raw text until it parses.
    input = tool.argsText;
  }
  return (
    <Tool>
      <ToolHeader type={`tool-${tool.name}`} state={tool.state} />
      <ToolContent>
        <ToolInput input={input} />
      </ToolContent>
    </Tool>
  );
}

/** What a `submit_plan` card needs from the controller to offer and report a decision. */
type PlanView = {
  pendingPlan: PendingPlan | null;
  activeMode: string | null;
  respondToPlan: UseAgentControllerChat['respondToPlan'];
};

function renderContent(
  part: AgentControllerContentPart,
  i: number,
  resultsById: Map<string, AgentControllerContentPart>,
  subagentsById: Map<string, SubagentRun>,
  planView: PlanView,
) {
  if (part.type === 'text') {
    return <ChatMarkdown key={i}>{(part as { text: string }).text}</ChatMarkdown>;
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
    // `ask_user` renders as the live AskUserPrompt (driven by tool_suspended), not a raw
    // tool card — suppress the call so the clarifying question isn't shown twice.
    if (call.name === 'ask_user') {
      return null;
    }
    // The built-in `subagent` tool → the nested <Agent> card, driven by the
    // subagent_* events accumulated for this tool-call id.
    if (call.name === 'subagent') {
      const run = subagentsById.get(call.id);
      const task = (call.args as { task?: string } | undefined)?.task;
      return <SubagentCard key={i} run={run} fallbackTask={task} />;
    }
    // submit_plan → the <Plan> element, with Approve / Reject while it awaits a decision.
    if (call.name === 'submit_plan') {
      const a = call.args as { path?: string; title?: string; plan?: string };
      return (
        <SubmittedPlanCard
          key={i}
          path={a?.path}
          title={a?.title}
          plan={a?.plan}
          pending={planView.pendingPlan?.toolCallId === call.id}
          activeMode={planView.activeMode}
          onDecide={(d) => planView.respondToPlan(d)}
        />
      );
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
