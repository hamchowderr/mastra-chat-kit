'use client';

import { ListChecksIcon } from 'lucide-react';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';

/**
 * Plan mode, as the chat skin renders it: the composer's Plan toggle. (The card a
 * `submit_plan` call becomes is shared by every skin: components/chat/transcript.tsx.) Planning is still agent-driven — the toggle only starts a
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
