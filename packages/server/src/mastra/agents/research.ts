import type { AgentControllerSubagent } from '@mastra/core/agent-controller';
import { env } from '../../lib/env';
import { type ChatFeatures, FULL_FEATURES } from '../lib/features';
import { FIRECRAWL_TOOLS } from '../lib/firecrawl';
import { searchKnowledge } from './chat';

/**
 * # Research Subagent (mastra-chat-kit)
 *
 * A research **specialist** the controller agent delegates to via the built-in `subagent`
 * tool (`agentType: 'research'`). Like the code specialist it runs `forked: false` — a
 * fresh agent built from THIS definition (its own instructions / model / tools), not a
 * clone of the parent.
 *
 * How it reads the live web follows the features (resolveFeatures only offers it when
 * one of these is on):
 * - Firecrawl: firecrawl_search + firecrawl_scrape, taken from the controller's tools via
 *   `allowedControllerTools` (lib/firecrawl.ts). Needs no sandbox or browser.
 * - otherwise the browser, which it inherits from the controller workspace and drives
 *   through the sandbox.
 * It also has `searchKnowledge` while the demo tools are on. A non-forked subagent can't
 * see the parent conversation, so the delegating agent passes the full question as the
 * task.
 */
export function researchSubagentFor(f: ChatFeatures): AgentControllerSubagent {
  const web = f.firecrawl
    ? "- For anything time-sensitive, factual, or about current events, search the live web with firecrawl_search, then read the most relevant pages with firecrawl_scrape before answering — don't answer from memory."
    : "- For anything time-sensitive, factual, or about current events, use your browser tools to visit relevant pages on the live web and READ them before answering — don't answer from memory.";
  return {
    id: 'research',
    name: 'Research',
    description:
      'Research specialist: answers open-ended questions by searching and reading the live web, then citing sources. Delegate "find out / look up / compare / what\'s the latest on…" questions to it.',
    instructions: `You are a research specialist. Your job is to find the answer and back it with evidence.

Workflow:
${[
  web,
  ...(f.demoTools ? ['- Use searchKnowledge for the internal knowledge base.'] : []),
  '- Cross-check when it matters; note disagreements between sources.',
].join('\n')}

Answer format:
- Lead with a direct, concise answer, then the supporting evidence.
- Cite the sources you actually used (URLs you read / document titles) — never fabricate a citation.
- If you couldn't verify something, say so plainly.

You cannot see the parent conversation, so treat the task as self-contained.`,
    defaultModelId: env.CHAT_MODEL,
    tools: f.demoTools ? { searchKnowledge } : {},
    // The controller carries the Firecrawl tools (lib/agent-controller.ts); this lets the
    // specialist use them too.
    ...(f.firecrawl ? { allowedControllerTools: [...FIRECRAWL_TOOLS] } : {}),
    forked: false,
  };
}

/** The research specialist with every feature on. */
export const researchSubagent: AgentControllerSubagent = researchSubagentFor(FULL_FEATURES);
