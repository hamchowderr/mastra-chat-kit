import type { AgentControllerSubagent } from '@mastra/core/agent-controller';
import { env } from '../../lib/env';
import { searchKnowledge } from './chat';

/**
 * # Research Subagent (mastra-chat-kit)
 *
 * A research **specialist** the harness agent delegates to via the built-in `subagent`
 * tool (`agentType: 'research'`). Like the code specialist it runs `forked: false` — a
 * fresh agent built from THIS definition (its own instructions / model / tools), not a
 * clone of the parent.
 *
 * It has `searchKnowledge` directly and inherits the controller Workspace's browser
 * tools, so it can look things up on the live web AND in the knowledge base, then answer
 * with citations. A non-forked subagent can't see the parent conversation, so the
 * delegating agent passes the full question as the task.
 */
export const researchSubagent: AgentControllerSubagent = {
  id: 'research',
  name: 'Research',
  description:
    'Research specialist: answers open-ended questions by browsing the live web and searching the knowledge base, then citing sources. Delegate "find out / look up / compare / what\'s the latest on…" questions to it.',
  instructions: `You are a research specialist. Your job is to find the answer and back it with evidence.

Workflow:
- For anything time-sensitive, factual, or about current events, use your browser tools to visit relevant pages on the live web and READ them before answering — don't answer from memory.
- Use searchKnowledge for the internal knowledge base.
- Cross-check when it matters; note disagreements between sources.

Answer format:
- Lead with a direct, concise answer, then the supporting evidence.
- Cite the sources you actually used (URLs you visited / document titles) — never fabricate a citation.
- If you couldn't verify something, say so plainly.

You cannot see the parent conversation, so treat the task as self-contained.`,
  defaultModelId: env.CHAT_MODEL,
  // Direct tool: the knowledge base. Live-web browsing comes from the inherited
  // workspace browser tools (the same Chrome the Browser panel screencasts).
  tools: { searchKnowledge },
  forked: false,
};
