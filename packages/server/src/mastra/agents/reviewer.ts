import type { AgentControllerSubagent } from '@mastra/core/agent-controller';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { env } from '../../lib/env';

/**
 * # Reviewer Subagent (mastra-chat-kit)
 *
 * Reads what the other specialists produced and critiques it. Delegated to via the
 * built-in `subagent` tool (`agentType: 'review'`).
 *
 * It is the roster's demonstration of **`allowedWorkspaceTools`**: the controller's
 * Workspace carries the full filesystem + shell surface, and every other subagent
 * inherits all of it. This one is narrowed to the READ tools only. A reviewer that
 * can silently rewrite the thing it is reviewing is not a reviewer, and "just tell it
 * not to" is a prompt, not a guarantee — the allow-list is enforced by the controller,
 * so the tools to mutate or execute are never even offered to it.
 *
 * Pairs with `code` (which writes) and `writer` (which drafts): hand it their output
 * and it reports back. It never fixes anything itself — findings go to the parent,
 * which decides what to act on.
 */
export const reviewerSubagent: AgentControllerSubagent = {
  id: 'review',
  name: 'Reviewer',
  description:
    'Review specialist with READ-ONLY workspace access: audits code or written drafts and reports concrete, prioritized findings. Delegate "review / check / audit / what is wrong with this" tasks to it. It cannot edit or run anything.',
  instructions: `You review work that already exists in the workspace. You have read-only access — you cannot edit, create, delete, or run anything, so never promise to fix something yourself.

Workflow:
- Read the relevant files before saying anything about them. Never review from the task description alone.
- Report findings most-important first. Lead with what is actually broken or wrong, then what is risky, then what is merely style.
- For each finding: name the file (and line where you can), say what is wrong, and say what it would take to fix it.
- If something looks wrong but you cannot confirm it from the files, say so and say what you would need to check.

Rules:
- Distinguish "this is broken" from "I would have done it differently". Only the first is a defect.
- Do not pad the list. If the work is sound, say it is sound and stop — a short honest review beats a long invented one.
- Never claim you verified behavior; you cannot run anything. Say what the code implies, not what it does at runtime.`,
  defaultModelId: env.CHAT_MODEL,
  // The enforcement, not the prompt, is what makes this read-only. Grep + file_stat
  // are included so it can navigate a tree it did not build; write/edit/delete/mkdir
  // and the whole SANDBOX group are deliberately absent.
  allowedWorkspaceTools: [
    WORKSPACE_TOOLS.FILESYSTEM.READ_FILE,
    WORKSPACE_TOOLS.FILESYSTEM.LIST_FILES,
    WORKSPACE_TOOLS.FILESYSTEM.FILE_STAT,
    WORKSPACE_TOOLS.FILESYSTEM.GREP,
  ],
  forked: false,
};
