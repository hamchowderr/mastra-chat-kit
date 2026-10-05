import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type FirecrawlMock,
  firecrawlToolList,
  MOCK_RESULT,
  OUT_OF_CREDITS,
  searchResponse,
  startFirecrawlMock,
} from '../../scripts/firecrawl-mock';
import {
  createFirecrawlClient,
  FIRECRAWL_TOOLS,
  getFirecrawlTools,
  loadFirecrawlTools,
} from '../../src/mastra/lib/firecrawl';

/**
 * lib/firecrawl.ts at the MCP boundary: the real MCPClient against AIMock's MCP mock,
 * which lists the tools a real firecrawl-mcp server lists. No model, no Firecrawl.
 */

let fc: FirecrawlMock;
beforeAll(async () => {
  fc = await startFirecrawlMock();
});
afterAll(async () => {
  await fc.stop();
});

let clients = 0;
/** A client for the mock; each gets its own id (MCPClient refuses duplicate configs). */
function client(url = fc.url, apiKey = 'fc-test-key') {
  clients += 1;
  return createFirecrawlClient({ apiKey, url, id: `firecrawl-unit-${clients}` });
}

describe('Firecrawl tools from the MCP server', () => {
  it('offers only search and scrape, under the names the server gives them', async () => {
    // The fixture really is the whole list: crawl, agent and the rest are there to drop.
    const listed = firecrawlToolList().map((t) => t.name);
    expect(listed).toEqual(
      expect.arrayContaining(['firecrawl_crawl', 'firecrawl_agent', 'firecrawl_map']),
    );

    const mcp = client();
    const tools = await loadFirecrawlTools(mcp);
    await mcp.disconnect();
    expect(Object.keys(tools).sort()).toEqual([...FIRECRAWL_TOOLS].sort());
  });

  it('sends the API key as a Bearer token', async () => {
    const mcp = client(fc.url, 'fc-bearer-check');
    await loadFirecrawlTools(mcp);
    await mcp.disconnect();
    expect(fc.authorizations()).toContain('Bearer fc-bearer-check');
  });

  it('a search returns what Firecrawl returned', async () => {
    const mcp = client();
    const tools = await loadFirecrawlTools(mcp);
    // biome-ignore lint/suspicious/noExplicitAny: MCP tool results are untyped
    const search = tools.firecrawl_search as any;
    const result = await search.execute({ query: 'latest Mastra release' }, {});
    await mcp.disconnect();
    expect(JSON.stringify(result)).toContain(MOCK_RESULT.url);
    expect(JSON.parse(result.content[0].text)).toEqual(searchResponse());
  });

  it('a Firecrawl error comes back as a thrown tool error carrying its message', async () => {
    fc.mock.onToolCall('firecrawl_search', () => {
      throw new Error(OUT_OF_CREDITS);
    });
    const mcp = client();
    try {
      const tools = await loadFirecrawlTools(mcp);
      // biome-ignore lint/suspicious/noExplicitAny: MCP tool results are untyped
      const search = tools.firecrawl_search as any;
      await expect(search.execute({ query: 'x' }, {})).rejects.toThrow('Insufficient credits');
    } finally {
      fc.mock.onToolCall('firecrawl_search', () => JSON.stringify(searchResponse()));
      await mcp.disconnect();
    }
  });

  it('an unreachable server means no tools, not a failed run', async () => {
    const mcp = client('http://127.0.0.1:9/mcp');
    const tools = await loadFirecrawlTools(mcp);
    await mcp.disconnect();
    expect(tools).toEqual({});
  });

  it('with no FIRECRAWL_API_KEY the server offers no Firecrawl tools', async () => {
    expect(await getFirecrawlTools()).toEqual({});
  });
});
