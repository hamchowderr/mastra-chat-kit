/**
 * Firecrawl's MCP server, mocked with AIMock's MCPMock, for the tests and for a local
 * run with no Firecrawl account and no credits spent.
 *
 * It advertises the tool list a real `firecrawl-mcp` server returns
 * (fixtures/firecrawl-mcp-tools.json, from scripts/capture-firecrawl-tools.ts) and
 * answers firecrawl_search / firecrawl_scrape with Firecrawl-shaped results: the JSON
 * text of the API response, as firecrawl-mcp returns it.
 *
 * One difference from the real server: the advertised tools carry no `outputSchema`.
 * The real server also returns `structuredContent`, which MCPMock cannot; an MCP client
 * rejects a result without it when the tool declares an output schema. The model still
 * gets the same JSON, as text.
 *
 * Run it on its own (it prints the URL to put in FIRECRAWL_MCP_URL):
 *   pnpm --filter @mastra-chat-kit/server exec tsx scripts/firecrawl-mock.ts [port]
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPMock } from '@copilotkit/aimock';

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/firecrawl-mcp-tools.json',
);

type ToolDef = { name: string; description?: string; inputSchema?: Record<string, unknown> };

/** The tools a real firecrawl-mcp server lists, minus their output schemas (see above). */
export function firecrawlToolList(): ToolDef[] {
  const { tools } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    tools: (ToolDef & { outputSchema?: unknown })[];
  };
  return tools.map(({ outputSchema: _dropped, ...def }) => def);
}

/** The page every mocked search finds. */
export const MOCK_RESULT = {
  url: 'https://mastra.ai/blog/mastra-1-70',
  title: 'Mastra 1.70: durable subagent runs',
  description: 'Mastra 1.70 adds durable subagent runs and faster tool discovery.',
};

/** A /v2/search response body, as firecrawl_search returns it. */
export function searchResponse() {
  return {
    success: true,
    data: { web: [{ ...MOCK_RESULT, position: 1 }] },
    creditsUsed: 2,
    id: 'search-mock-1',
  };
}

/** A /v2/scrape response body, as firecrawl_scrape returns it. */
export function scrapeResponse(url: string) {
  return {
    success: true,
    data: {
      markdown: `# ${MOCK_RESULT.title}\n\n${MOCK_RESULT.description}`,
      metadata: { title: MOCK_RESULT.title, sourceURL: url, statusCode: 200 },
    },
  };
}

/** The error firecrawl-mcp relays when the account has no credits left (HTTP 402). */
export const OUT_OF_CREDITS =
  'Payment Required: Failed to search. Insufficient credits to perform this request. For more credits, you can upgrade your plan at https://firecrawl.dev/pricing.';

export type FirecrawlMock = {
  mock: MCPMock;
  /** The MCP endpoint: what FIRECRAWL_MCP_URL points at. */
  url: string;
  /** The Authorization header of every request the mock received. */
  authorizations(): string[];
  /** Every tool call that reached the mock, in order. */
  calls: { name: string; args: unknown }[];
  stop(): Promise<void>;
};

/**
 * Start the mock on `port` (0 = any free port). MCPMock is mounted on a plain server
 * that notes each request's Authorization header (AIMock's journal redacts it) and
 * answers 405 to the GET a Streamable HTTP client opens for server notifications, which
 * the MCP spec allows a server that sends none.
 */
export async function startFirecrawlMock(port = 0): Promise<FirecrawlMock> {
  const mock = new MCPMock({ serverInfo: { name: 'firecrawl-fastmcp', version: '3.27.3' } });
  const calls: { name: string; args: unknown }[] = [];
  for (const def of firecrawlToolList()) {
    mock.addTool(def);
    mock.onToolCall(def.name, (args) => {
      calls.push({ name: def.name, args });
      if (def.name === 'firecrawl_search') return JSON.stringify(searchResponse());
      if (def.name === 'firecrawl_scrape') {
        return JSON.stringify(
          scrapeResponse(String((args as { url?: string })?.url ?? MOCK_RESULT.url)),
        );
      }
      return '{}';
    });
  }
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers.authorization ?? '');
    mock
      .handleRequest(req, res, '/')
      .then((handled) => {
        if (!handled) {
          res.writeHead(405);
          res.end();
        }
      })
      .catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: bound } = server.address() as AddressInfo;
  return {
    mock,
    url: `http://127.0.0.1:${bound}/mcp`,
    authorizations: () => [...seen],
    calls,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

// `tsx scripts/firecrawl-mock.ts [port]` runs it standalone.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startFirecrawlMock(Number(process.argv[2] ?? 4020));
  console.log(`Firecrawl MCP mock: ${url}`);
}
