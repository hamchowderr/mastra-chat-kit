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
 *
 * Those two run with no approval card and in Plan mode, so their schemas are narrowed
 * to plain search and plain page reads before the agent sees them (restrictDefinition).
 */

/** The MCPClient server key. */
const SERVER = 'firecrawl';

/**
 * The Firecrawl tools the agent is offered, under the server's own names (the key of
 * MCPClient's per-server definitions; `listTools()` would prefix them as
 * `firecrawl_firecrawl_search`). Firecrawl's tool descriptions refer to each other by
 * these names ("use `firecrawl_scrape` on a result URL"), so the model must see them.
 */
export const FIRECRAWL_TOOLS = ['firecrawl_search', 'firecrawl_scrape'] as const;

/**
 * Inputs removed from the offered schemas. Each one makes a call do more than read the
 * web, which an auto-allowed, Plan-mode tool must not:
 * - `alexandria`: runs paid third-party data providers (scrape);
 * - `actions`: clicks, types and runs JavaScript on the page before reading it;
 * - `profile`: loads (and can save) a stored browser session;
 * - `proxy`: stealth/enhanced proxies, billed at a higher rate;
 * - `jsonOptions`: LLM extraction, billed per page on top of the scrape;
 * - `domainTools`, `toolDetail`: Alexandria tool discovery attached to results.
 * scrape's top level and search's `scrapeOptions` both carry these.
 */
export const REMOVED_INPUTS = [
  'alexandria',
  'actions',
  'profile',
  'proxy',
  'jsonOptions',
  'domainTools',
  'toolDetail',
] as const;

/**
 * The search sources the agent may pick. Firecrawl also accepts `alexandria` and
 * `exchange` (its provider catalogue), and with an API key it searches
 * `["web", "alexandria"]` when `sources` is omitted (firecrawl-mcp's search tool:
 * "authenticated sessions default to web + alexandria"). So `sources` is narrowed to
 * these and made required: no call can reach Alexandria, by choice or by default.
 */
export const SEARCH_SOURCES = ['web', 'news', 'images'] as const;

/**
 * How long tool discovery may take before a run goes ahead without the tools. The
 * controller resolves its tools at the start of every run (and on every approve or
 * decline), so a slow or unreachable server must not hold a run for MCPClient's 60s
 * default.
 */
const DISCOVERY_TIMEOUT_MS = 10_000;

/** After a failed discovery, runs skip Firecrawl this long instead of waiting again. */
export const DISCOVERY_BACKOFF_MS = 60_000;

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
        // The key is only ever sent to the configured host, never to a redirect target.
        allowedHosts: [new URL(url).host],
      },
    },
  });
}

type Definition = Awaited<ReturnType<MCPClient['listToolDefinitions']>>[string][string];
type JsonSchema = {
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  enum?: unknown[];
  description?: string;
  [key: string]: unknown;
};

/** Drop REMOVED_INPUTS from an object schema's properties and required list. */
function withoutRemovedInputs(schema: JsonSchema): JsonSchema {
  const removed = new Set<string>(REMOVED_INPUTS);
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties ?? {}).filter(([key]) => !removed.has(key)),
    ),
    ...(schema.required ? { required: schema.required.filter((k) => !removed.has(k)) } : {}),
  };
}

/** Narrow every `enum` under a schema to SEARCH_SOURCES. */
function onlySearchSources(schema: JsonSchema): JsonSchema {
  const allowed = new Set<unknown>(SEARCH_SOURCES);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        key,
        key === 'enum' && Array.isArray(value) ? value.filter((v) => allowed.has(v)) : walk(value),
      ]),
    );
  };
  return walk(schema) as JsonSchema;
}

/**
 * A definition as the agent is offered it. Both schemas set `additionalProperties:
 * false`, so a removed input is not just hidden from the model: a call that still sends
 * one fails the tool's input validation and never reaches Firecrawl.
 */
export function restrictDefinition(definition: Definition): Definition {
  const schema = withoutRemovedInputs(definition.inputSchema as JsonSchema);
  const properties = schema.properties ?? {};
  if (definition.name === 'firecrawl_scrape') {
    // With `alexandria` gone, a page URL is the only thing scrape can work on.
    return {
      ...definition,
      inputSchema: { ...schema, required: [...new Set([...(schema.required ?? []), 'url'])] },
    };
  }
  if (definition.name === 'firecrawl_search') {
    const scrapeOptions = properties.scrapeOptions;
    return {
      ...definition,
      inputSchema: {
        ...schema,
        properties: {
          ...properties,
          sources: {
            ...onlySearchSources(properties.sources ?? {}),
            description: `Where to search: ${SEARCH_SOURCES.join(', ')}. Required; use ["web"] for ordinary web results.`,
          },
          ...(scrapeOptions ? { scrapeOptions: withoutRemovedInputs(scrapeOptions) } : {}),
        },
        required: [...new Set([...(schema.required ?? []), 'sources'])],
      },
    };
  }
  return definition;
}

/**
 * The offered Firecrawl tools from a client, or `{}` when the server can't be reached
 * or rejects the key, so a Firecrawl outage never fails a run: the agent just has no
 * web search for it. Built the Mastra way for a narrowed definition: discover the
 * definitions, narrow them, then `toolFromDefinition`. A Firecrawl error during a call
 * (out of credits, a bad URL) comes back as a tool error the agent can read
 * (MCPClient's `onToolError: 'throw'`, which the agent loop turns into an error result).
 */
export async function loadFirecrawlTools(client: MCPClient): Promise<ToolsInput> {
  const { definitions, errors } = await client.listToolDefinitionsWithErrors({
    perServerTimeoutMs: DISCOVERY_TIMEOUT_MS,
  });
  if (errors[SERVER]) {
    console.warn(`Firecrawl tools unavailable: ${errors[SERVER]}`);
    return {};
  }
  const listed = definitions[SERVER] ?? {};
  const tools: ToolsInput = {};
  for (const name of FIRECRAWL_TOOLS) {
    const definition = listed[name];
    if (!definition) continue;
    tools[name] = await client.toolFromDefinition({
      serverName: SERVER,
      definition: restrictDefinition(definition),
    });
  }
  return tools;
}

let client: MCPClient | null = null;
let loaded: ToolsInput | null = null;
let pending: Promise<ToolsInput> | null = null;
let failedAt = 0;

/**
 * The live server's Firecrawl tools (from FIRECRAWL_API_KEY / FIRECRAWL_MCP_URL), or `{}`
 * when the key is unset. The first successful listing is kept. A failed one is not
 * retried for DISCOVERY_BACKOFF_MS, so a down or hanging endpoint costs one wait, not
 * one per send, approve or decline. Concurrent callers share one discovery.
 */
export async function getFirecrawlTools(now: () => number = Date.now): Promise<ToolsInput> {
  if (!env.FIRECRAWL_API_KEY) return {};
  if (loaded) return loaded;
  if (failedAt && now() - failedAt < DISCOVERY_BACKOFF_MS) return {};
  if (!pending) {
    const apiKey = env.FIRECRAWL_API_KEY;
    client ??= createFirecrawlClient({ apiKey, url: env.FIRECRAWL_MCP_URL });
    pending = loadFirecrawlTools(client)
      .then((tools) => {
        if (Object.keys(tools).length) {
          loaded = tools;
          failedAt = 0;
        } else {
          failedAt = now();
        }
        return tools;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/**
 * Close the live client's connection. The controller calls it from its shutdown hook
 * (lib/agent-controller.ts), which Mastra runs on SIGINT/SIGTERM.
 */
export async function disconnectFirecrawl(): Promise<void> {
  const open = client;
  client = null;
  loaded = null;
  pending = null;
  failedAt = 0;
  await open?.disconnect();
}
