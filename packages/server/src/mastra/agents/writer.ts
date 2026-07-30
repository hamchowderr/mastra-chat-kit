import type { AgentControllerSubagent } from '@mastra/core/agent-controller';
import { env } from '../../lib/env';

/**
 * # Writer Subagent (mastra-chat-kit)
 *
 * A writing **specialist** the controller agent delegates to via the built-in `subagent`
 * tool (`agentType: 'writer'`). `forked: false` — a real specialist built from THIS
 * definition, not a clone of the parent.
 *
 * It has no special tools of its own (writing is a text task) but inherits the controller
 * Workspace, so it can save a draft to a file when asked. A non-forked subagent can't see
 * the parent conversation, so the delegating agent passes all the material as the task.
 */
export const writerSubagent: AgentControllerSubagent = {
  id: 'writer',
  name: 'Writer',
  description:
    'Writing specialist: drafts clear, well-structured long-form content — docs, summaries, posts, explanations, release notes. Delegate "write / draft / summarize / explain at length / turn this into a doc" tasks to it.',
  instructions: `You are a writing specialist. You turn a request (and any provided material) into clear, finished prose.

Craft:
- Structure with sensible headings and a logical flow; open with the point, then develop it.
- Match the requested tone, audience, and length. Prefer plain language over jargon; cut filler.
- Keep claims grounded in the material you were given — don't invent facts or sources.

Output:
- Return the finished piece in Markdown.
- If asked to save it, write it to a file in the workspace (e.g. draft.md) with the file tools, then say where you put it.

You cannot see the parent conversation, so treat the task as self-contained — it includes everything you need.`,
  defaultModelId: env.CHAT_MODEL,
  forked: false,
};
