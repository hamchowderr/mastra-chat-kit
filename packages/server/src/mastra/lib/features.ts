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
/**
 * Which browser the agent gets:
 * - `viewer`: `@mastra/browser-viewer`, a local Chrome the agent drives with the browser
 *   CLI through execute_command. Needs the sandbox.
 * - `firecrawl`: `@mastra/browser-firecrawl`, hosted Firecrawl browser sessions driven by
 *   the provider's own browser_* tools (lib/firecrawl-browser.ts). Needs FIRECRAWL_API_KEY,
 *   not the sandbox.
 */
export type BrowserProvider = 'viewer' | 'firecrawl';

export type ChatFeatures = {
  /** Shell sandbox (execute_command). */
  sandbox: boolean;
  /**
   * The browser + the Browser panel. `auto` picks a provider (resolveFeatures), `false`
   * turns the browser off. After resolveFeatures it is a provider or `false`.
   */
  browser: BrowserProvider | 'auto' | false;
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
  /** Anthropic prompt-cache breakpoints (lib/turn-context.ts). */
  promptCache: boolean;
};

export const FULL_FEATURES: ChatFeatures = {
  sandbox: true,
  browser: 'auto',
  firecrawl: true,
  subagents: { code: true, research: true, writer: true, review: true, data: true },
  generateImage: true,
  demoTools: true,
  promptCache: true,
};

/**
 * Resolve the switches into what is actually available. A piece is only offered when
 * what it works with is there, so the agent is never told about one that would fail
 * every call:
 * - the browser (resolveBrowser): `viewer` needs the sandbox, because
 *   `@mastra/browser-viewer` gives the agent no browser tools of its own and the agent
 *   drives Chrome with the browser CLI through execute_command; `firecrawl` needs the
 *   Firecrawl key;
 * - `code` needs the sandbox (it builds AND runs code);
 * - `research` needs a way to read the live web: Firecrawl, or the browser;
 * - `data` needs Dolt.
 */
export function resolveFeatures(
  input: ChatFeatures,
  { dolt = doltConfigured }: { dolt?: boolean } = {},
): ChatFeatures {
  const browser = resolveBrowser(input);
  return {
    ...input,
    browser,
    subagents: {
      ...input.subagents,
      code: input.subagents.code && input.sandbox,
      research: input.subagents.research && (input.firecrawl || browser !== false),
      data: input.subagents.data && dolt,
    },
  };
}

/**
 * The browser provider for a set of switches, or `false` when there is none:
 * - an explicit provider (BROWSER_PROVIDER) when what it needs is there;
 * - `auto`: `firecrawl` when the Firecrawl key is set and the sandbox is off, else
 *   `viewer` when the sandbox is on, else none. With both the key and the sandbox, the
 *   local viewer is kept, so a server that had it before this switch keeps it.
 */
export function resolveBrowser(
  input: Pick<ChatFeatures, 'browser' | 'sandbox' | 'firecrawl'>,
): BrowserProvider | false {
  switch (input.browser) {
    case false:
      return false;
    case 'viewer':
      return input.sandbox ? 'viewer' : false;
    case 'firecrawl':
      return input.firecrawl ? 'firecrawl' : false;
    default:
      if (input.firecrawl && !input.sandbox) return 'firecrawl';
      return input.sandbox ? 'viewer' : false;
  }
}

export const features: ChatFeatures = resolveFeatures({
  sandbox: env.WORKSPACE_SANDBOX,
  browser: env.WORKSPACE_BROWSER ? (env.BROWSER_PROVIDER ?? 'auto') : false,
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
  promptCache: env.PROMPT_CACHE,
});
