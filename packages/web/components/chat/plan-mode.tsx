'use client';

import { CheckIcon, ListChecksIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { MessageResponse } from '@/components/ai-elements/message';
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
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import { useWorkspaceFile } from '@/lib/agent-controller/use-workspace';

/**
 * Plan mode, as the chat skin renders it: the composer's Plan toggle, and the card a
 * `submit_plan` call becomes. Planning is still agent-driven — the toggle only starts a
 * turn in the controller's Plan mode, whose instructions tell the agent to plan and
 * submit rather than act. Approving the plan switches the session back to Chat
 * (the mode's `transitionsTo`) and the agent carries on with the work.
 */

/** Composer toggle: send the next turn in Plan mode. Sits beside Search. */
export function PlanModeToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <PromptInputButton
      onClick={onToggle}
      tooltip={{ content: 'Plan first: the agent proposes a plan for you to approve' }}
      variant={on ? 'default' : 'ghost'}
      aria-pressed={on}
      className="transition active:scale-[0.96]"
    >
      <ListChecksIcon className="size-4" />
      <span>Plan</span>
    </PromptInputButton>
  );
}

type Decision = 'approved' | 'rejected';

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
    <Plan defaultOpen>
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
          <MessageResponse>{body}</MessageResponse>
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
