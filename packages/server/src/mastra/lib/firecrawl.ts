import type { ToolsInput } from '@mastra/core/agent';
import { MCPClient } from '@mastra/mcp';
import { env } from '../../lib/env';

/**
 * # Firecrawl web search
 *
 * Web search and page reading that need no sandbox or browser. The tools come from
 * Firecrawl's own MCP server (`firecrawl-mcp`), which is what `@mastra/firecrawl` now
 * points to after its deprecation. Firecrawl hosts that server at
 * `https://mcp.firecrawl.dev/v2/mcp` (Streamable HTTP; an API key goes in an
 * `Authorization: Bearer` header), so nothing is spawned in the agent's container.
 *
 * Setting FIRECRAWL_API_KEY turns this on. The AgentController carries these tools
 * (`tools` on the controller), so the chat agent gets them on every run and the research
 * subagent picks them up through `allowedControllerTools` (lib/agent-controller.ts).
 *
 * The server lists about 27 tools. Only the two in FIRECRAWL_TOOLS are offered: search,
 * and scrape to read one page. Crawl, map, agent, interact, monitors and the rest either
 * spend many credits per call, run long jobs, or act on pages, and the kit's research
 * job does not need them.
 */

/** The MCPClient server key. */
const SERVER = 'firecrawl';

/**
 * The Firecrawl tools the agent is offered, under the server's own names. They are
 * taken from MCPClient's per-server toolset, which keys tools by the server's names
 * (`listTools()` would prefix them as `firecrawl_firecrawl_search`). Firecrawl's tool
 * descriptions refer to each other by these names ("use `firecrawl_scrape` on a result
 * URL"), so the names the model sees must match them.
 */
export const FIRECRAWL_TOOLS = ['firecrawl_search', 'firecrawl_scrape'] as const;

/**
 * How long tool discovery may take before a run goes ahead without the tools. The
 * controller resolves its tools at the start of every run, so a slow or unreachable
 * server must not hold a run for MCPClient's 60s default.
 */
const DISCOVERY_TIMEOUT_MS = 10_000;

/** An MCPClient for Firecrawl's MCP server, authenticated with an API key. */
export function createFirecrawlClient({
  apiKey,
  url,
  id = 'firecrawl',
}: {
  apiKey: string;
  url: string;
  /** MCPClient refuses two clients with the same config and no id; tests pass their own. */
  id?: string;
}): MCPClient {
  return new MCPClient({
    id,
    servers: {
      [SERVER]: {
        url: new URL(url),
        requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
      },
    },
  });
}

/**
 * The offered Firecrawl tools from a client, or `{}` when the server can't be reached
 * or rejects the key, so a Firecrawl outage never fails a run: the agent just has no
 * web search for it. A Firecrawl error during a call (out of credits, a bad URL) comes
 * back as a tool error the agent can read (MCPClient's `onToolError: 'throw'`, which
 * the agent loop turns into an error result).
 */
export async function loadFirecrawlTools(client: MCPClient): Promise<ToolsInput> {
  const { toolsets, errors } = await client.listToolsetsWithErrors({
    perServerTimeoutMs: DISCOVERY_TIMEOUT_MS,
  });
  if (errors[SERVER]) {
    console.warn(`Firecrawl tools unavailable for this run: ${errors[SERVER]}`);
    return {};
  }
  const listed = toolsets[SERVER] ?? {};
  return Object.fromEntries(
    FIRECRAWL_TOOLS.filter((name) => name in listed).map((name) => [name, listed[name]]),
  );
}

let client: MCPClient | null = null;
let loaded: ToolsInput | null = null;

/**
 * The live server's Firecrawl tools (from FIRECRAWL_API_KEY / FIRECRAWL_MCP_URL), or `{}`
 * when the key is unset. The first successful listing is kept; a failed one is retried
 * on the next run.
 */
export async function getFirecrawlTools(): Promise<ToolsInput> {
  if (!env.FIRECRAWL_API_KEY) return {};
  if (loaded) return loaded;
  client ??= createFirecrawlClient({ apiKey: env.FIRECRAWL_API_KEY, url: env.FIRECRAWL_MCP_URL });
  const tools = await loadFirecrawlTools(client);
  if (Object.keys(tools).length) loaded = tools;
  return tools;
}

/** Close the live client's connection (tests, shutdown). */
export async function disconnectFirecrawl(): Promise<void> {
  await client?.disconnect();
  client = null;
  loaded = null;
}
