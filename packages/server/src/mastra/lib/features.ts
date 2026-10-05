import { env } from '../../lib/env';
import { doltConfigured } from './dolt';

/**
 * # What the agent can do
 *
 * One object that says which parts of the kit are switched on, read once from env.
 * Every switch defaults to the full kit, so a server with none of these set behaves
 * exactly as before. The workspace, the subagent roster, the chat agent's tools and its
 * instructions all read this, and each takes it as an argument so tests can build any
 * combination without reloading env.
 */
export type ChatFeatures = {
  /** Shell sandbox (execute_command). */
  sandbox: boolean;
  /** Headless browser + the Browser panel. Also needs the sandbox. */
  browser: boolean;
  /** Firecrawl search + scrape (lib/firecrawl.ts): on when FIRECRAWL_API_KEY is set. */
  firecrawl: boolean;
  subagents: {
    code: boolean;
    research: boolean;
    writer: boolean;
    review: boolean;
    /** Also needs Dolt configured. */
    data: boolean;
  };
  generateImage: boolean;
  /** getWeather + searchKnowledge, the deterministic demo tools. */
  demoTools: boolean;
};

export const FULL_FEATURES: ChatFeatures = {
  sandbox: true,
  browser: true,
  firecrawl: true,
  subagents: { code: true, research: true, writer: true, review: true, data: true },
  generateImage: true,
  demoTools: true,
};

/**
 * Resolve the switches into what is actually available. A piece is only offered when
 * what it works with is there, so the agent is never told about one that would fail
 * every call:
 * - the browser needs the sandbox: `@mastra/browser-viewer` gives the agent no browser
 *   tools of its own, and the agent drives Chrome with the browser CLI through
 *   execute_command;
 * - `code` needs the sandbox (it builds AND runs code);
 * - `research` needs a way to read the live web: Firecrawl, or the browser;
 * - `data` needs Dolt.
 */
export function resolveFeatures(
  input: ChatFeatures,
  { dolt = doltConfigured }: { dolt?: boolean } = {},
): ChatFeatures {
  const browser = input.browser && input.sandbox;
  return {
    ...input,
    browser,
    subagents: {
      ...input.subagents,
      code: input.subagents.code && input.sandbox,
      research: input.subagents.research && (input.firecrawl || browser),
      data: input.subagents.data && dolt,
    },
  };
}

export const features: ChatFeatures = resolveFeatures({
  sandbox: env.WORKSPACE_SANDBOX,
  browser: env.WORKSPACE_BROWSER,
  firecrawl: Boolean(env.FIRECRAWL_API_KEY),
  subagents: {
    code: env.SUBAGENT_CODE,
    research: env.SUBAGENT_RESEARCH,
    writer: env.SUBAGENT_WRITER,
    review: env.SUBAGENT_REVIEW,
    data: env.SUBAGENT_DATA,
  },
  generateImage: env.TOOL_GENERATE_IMAGE,
  demoTools: env.TOOL_DEMO,
});
