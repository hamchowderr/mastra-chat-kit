'use client';

import { ListChecksIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';

/**
 * Plan mode in the composer: the Plan toggle and the state behind it, shared by the full
 * shell and the side panel. (The card a `submit_plan` call becomes is in
 * components/chat/transcript.tsx.) Planning is still agent-driven: the toggle only starts
 * a turn in the controller's Plan mode, whose instructions tell the agent to plan and
 * submit rather than act. Approving the plan switches the session back to Chat (the
 * mode's `transitionsTo`) and the agent carries on with the work.
 */

/** Composer toggle: send the next turn in Plan mode. */
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

/**
 * The toggle's state. `mode` is what a turn sends (`'plan'` while it is on). When the
 * session reports Chat mode again (`mode_changed`, after a plan is approved) the toggle
 * turns itself off.
 */
export function usePlanMode(activeMode: string | null) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (activeMode === 'chat') setOn(false);
  }, [activeMode]);
  return {
    on,
    toggle: () => setOn((v) => !v),
    mode: (on ? 'plan' : 'chat') as 'plan' | 'chat',
  };
}
