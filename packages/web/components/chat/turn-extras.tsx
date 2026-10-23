'use client';

import { CopyIcon } from 'lucide-react';
import { Agent, AgentContent, AgentHeader } from '@/components/ai-elements/agent';
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
import { MessageAction, MessageActions } from '@/components/ai-elements/message';
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
} from '@/components/ai-elements/queue';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { ChatMarkdown } from '@/components/chat/chat-markdown';
import type { AgentControllerContentPart, SubagentRun } from '@/lib/agent-controller/events';
import type { UseAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';

/**
 * What every skin shows around a turn, beside its parts: the Copy action under a reply, a
 * subagent's nested card, the count of messages waiting their turn, and the token usage that
 * rides in the composer's footer.
 */

/** The plain text of an assistant turn (its text parts only). */
export function turnText(content: AgentControllerContentPart[]): string {
  return content
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text ?? '')
    .join('\n');
}

/** Copy under an assistant reply: its text, without tool calls. */
export function CopyTurn({ content }: { content: AgentControllerContentPart[] }) {
  return (
    <MessageActions>
      <MessageAction
        tooltip="Copy"
        label="Copy"
        onClick={() => navigator.clipboard?.writeText(turnText(content))}
      >
        <CopyIcon className="size-4" />
      </MessageAction>
    </MessageActions>
  );
}

/**
 * A subagent invocation → the <Agent> card: header (type + model + forked badge),
 * the delegated task, the subagent's nested tool calls, its streamed text, and a
 * live/`done`/error footer. Driven by the accumulated `subagent_*` events; falls
 * back to the parent tool-call `task` before any subagent event arrives.
 */
export function SubagentCard({
  run,
  fallbackTask,
}: {
  run?: SubagentRun | undefined;
  fallbackTask?: string | undefined;
}) {
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
        {run?.text && <ChatMarkdown>{run.text}</ChatMarkdown>}
        {running ? (
          <p className="animate-pulse text-muted-foreground text-xs italic">Working…</p>
        ) : run?.isError ? (
          <p className="text-destructive text-xs">Subagent reported an error.</p>
        ) : null}
      </AgentContent>
    </Agent>
  );
}

/**
 * Messages sent while a run was busy are queued server-side and replayed when it settles
 * (`follow_up_queued`). Without this the count is folded into state and never shown, so the
 * person gets no sign they landed.
 */
export function QueuedFollowUps({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Queue className="px-2">
      <QueueList>
        <QueueItem>
          <QueueItemIndicator />
          <QueueItemContent>
            <QueueItemDescription>
              {count === 1
                ? '1 message queued — it will send when this run finishes'
                : `${count} messages queued — they will send when this run finishes`}
            </QueueItemDescription>
          </QueueItemContent>
        </QueueItem>
      </QueueList>
    </Queue>
  );
}

/** The conversation's live token usage, for the composer's footer. Nothing before a turn. */
export function UsageContext({
  usage,
  modelId = 'anthropic/claude-haiku-4-5',
  maxTokens = 200_000,
}: {
  usage: UseAgentControllerChat['transcript']['usage'];
  /** The model the cost estimate is priced for. */
  modelId?: string;
  maxTokens?: number;
}) {
  if (!usage) return null;
  return (
    <Context
      usedTokens={usage.totalTokens ?? 0}
      maxTokens={maxTokens}
      modelId={modelId}
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
  );
}
