'use client';

import { CheckIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { Attachment, AttachmentPreview, Attachments } from '@/components/ai-elements/attachments';
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from '@/components/ai-elements/confirmation';
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanFooter,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from '@/components/ai-elements/plan';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { ChatMarkdown } from '@/components/chat/chat-markdown';
import { GeneratedImage } from '@/components/chat/tool-views';
import { Button } from '@/components/ui/button';
import type { AgentControllerContentPart } from '@/lib/agent-controller/events';
import type { UseAgentControllerChat } from '@/lib/agent-controller/use-agent-controller-chat';
import { useWorkspaceFile } from '@/lib/agent-controller/use-workspace';

/**
 * The transcript pieces every skin needs, shipped in `chat-tool-views` so no skin
 * imports another: one content part → its element, the tool-approval card, and the
 * submitted-plan card. Approvals and plans are not optional — every tool is gated and
 * `submit_plan` parks the run, so a skin without them leaves the agent waiting forever.
 */

type Decision = 'approved' | 'rejected';

/**
 * A stable key for a message's content part. Content is append-only and text parts
 * carry no id, so the position within the message is the identity.
 */
export function partKey(messageId: string, index: number): string {
  return `${messageId}-${index}`;
}

/**
 * A `submit_plan` call → the Plan element. The tool carries only the plan file's path,
 * so the text is read from the workspace. While the plan awaits a decision (`pending`)
 * the footer offers Approve / Reject; afterwards it says what happened, including the
 * switch back to Chat mode once `mode_changed` reports it.
 */
export function SubmittedPlanCard({
  path,
  title,
  plan,
  pending,
  activeMode,
  onDecide,
}: {
  path?: string;
  title?: string;
  /** Inline plan text, when a tool passes it instead of a path. */
  plan?: string;
  pending: boolean;
  activeMode: string | null;
  onDecide: (decision: Decision) => void;
}) {
  const fileText = useWorkspaceFile(plan ? undefined : path);
  const [decided, setDecided] = useState<Decision | null>(null);
  // Only claim a switch when there was one: a plan submitted unprompted from Chat mode
  // stays in Chat when approved.
  const [modeAtDecision, setModeAtDecision] = useState<string | null>(null);
  const text = plan ?? fileText;
  const heading = title ?? text?.match(/^#\s+(.+)$/m)?.[1] ?? 'Plan';
  // The file's own "# Title" line is already the card title.
  const body = text?.replace(/^#\s+.+\n+/, '');

  const decide = (d: Decision) => {
    setDecided(d);
    setModeAtDecision(activeMode);
    onDecide(d);
  };

  return (
    // `@container` (from Card) gives the card no width of its own inside the fit-width
    // message bubble, so it would collapse to nothing; it sizes to its content instead.
    <Plan defaultOpen className="w-full [container-type:normal]">
      <PlanHeader>
        <div>
          <PlanTitle>{heading}</PlanTitle>
          <PlanDescription>
            {path ? `Proposed by the agent · ${path}` : 'Proposed by the agent'}
          </PlanDescription>
        </div>
        <PlanAction>
          <PlanTrigger />
        </PlanAction>
      </PlanHeader>
      <PlanContent>
        {body ? (
          <ChatMarkdown>{body}</ChatMarkdown>
        ) : (
          <p className="text-muted-foreground text-sm">Loading the plan…</p>
        )}
      </PlanContent>
      <PlanFooter className="gap-2">
        {pending && !decided ? (
          <>
            <Button size="sm" onClick={() => decide('approved')}>
              <CheckIcon className="size-4" />
              Approve plan
            </Button>
            <Button size="sm" variant="outline" onClick={() => decide('rejected')}>
              <XIcon className="size-4" />
              Reject
            </Button>
          </>
        ) : decided === 'rejected' ? (
          <p className="text-muted-foreground text-sm">Plan rejected.</p>
        ) : decided === 'approved' ? (
          <p className="text-muted-foreground text-sm">
            Plan approved
            {modeAtDecision === 'plan' && activeMode === 'chat'
              ? ' · switched to Chat mode to carry it out.'
              : '.'}
          </p>
        ) : null}
      </PlanFooter>
    </Plan>
  );
}

/**
 * The tool-approval card for the pending gate: the tool, its real arguments, and
 * Approve / Always allow <category> / Reject.
 */
export function ApprovalCard({ controller }: { controller: UseAgentControllerChat }) {
  const pending = controller.transcript.pendingApproval;
  if (!pending) return null;
  const { approve } = controller;
  return (
    <Confirmation state="approval-requested" approval={{ id: pending.toolCallId }}>
      <ConfirmationTitle>Run {pending.toolName}?</ConfirmationTitle>
      <ConfirmationRequest>
        <pre className="overflow-x-auto text-xs">{JSON.stringify(pending.args, null, 2)}</pre>
        <ConfirmationActions className="flex-wrap">
          <ConfirmationAction onClick={() => approve('approve')}>Approve</ConfirmationAction>
          {pending.category && (
            <ConfirmationAction variant="outline" onClick={() => approve('always_allow_category')}>
              Always allow {pending.category} tools
            </ConfirmationAction>
          )}
          <ConfirmationAction variant="outline" onClick={() => approve('decline')}>
            Reject
          </ConfirmationAction>
        </ConfirmationActions>
      </ConfirmationRequest>
    </Confirmation>
  );
}

/**
 * One transcript content part → its element: text, reasoning, a generated image, a
 * submitted plan (with Approve / Reject while it waits), or a tool with its input and
 * output. `tool_result` parts render with their `tool_call`, so they return null here.
 */
export function TranscriptPart({
  part,
  resultsById,
  controller,
}: {
  part: AgentControllerContentPart;
  resultsById: Map<string, { result?: unknown; isError?: boolean }>;
  controller: UseAgentControllerChat;
}) {
  if (part.type === 'text') {
    return <ChatMarkdown>{(part as { text: string }).text}</ChatMarkdown>;
  }
  if (part.type === 'thinking') {
    return (
      <Reasoning isStreaming={false}>
        <ReasoningTrigger />
        <ReasoningContent>{(part as { thinking: string }).thinking}</ReasoningContent>
      </Reasoning>
    );
  }
  if (part.type === 'file') {
    // A file the user attached: a thumbnail for an image, a labelled chip otherwise.
    const file = part as { data: string; mediaType: string; filename?: string };
    return (
      <Attachments variant="grid">
        <Attachment
          data={{
            id: file.data.slice(-24),
            type: 'file',
            url: file.data,
            mediaType: file.mediaType,
            filename: file.filename,
          }}
        >
          <AttachmentPreview />
        </Attachment>
      </Attachments>
    );
  }
  if (part.type === 'image') {
    const img = part as { data: string; mimeType: string };
    return <GeneratedImage base64={img.data} mediaType={img.mimeType} />;
  }
  if (part.type === 'tool_call') {
    const call = part as { id: string; name: string; args: unknown };
    // These own dedicated surfaces elsewhere (the goal card, the live AskUserPrompt) —
    // rendering the raw call would double up.
    if (call.name === 'setGoal' || call.name === 'ask_user') return null;
    if (call.name === 'submit_plan') {
      const a = call.args as { path?: string; title?: string; plan?: string } | undefined;
      return (
        <SubmittedPlanCard
          path={a?.path}
          title={a?.title}
          plan={a?.plan}
          pending={controller.pendingPlan?.toolCallId === call.id}
          activeMode={controller.activeMode}
          onDecide={(d) => controller.respondToPlan(d)}
        />
      );
    }
    const result = resultsById.get(call.id);
    const hasOutput = result !== undefined;
    // generateImage returns only an id; GeneratedImage fetches the bytes.
    const img = result?.result as
      | { imageId?: string; mediaType?: string; prompt?: string }
      | undefined;
    if (call.name === 'generateImage' && img?.imageId) {
      return (
        <GeneratedImage
          imageId={img.imageId}
          mediaType={img.mediaType ?? 'image/webp'}
          prompt={img.prompt}
        />
      );
    }
    return (
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
    );
  }
  return null;
}
