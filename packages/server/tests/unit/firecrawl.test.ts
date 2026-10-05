import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
  REMOVED_INPUTS,
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
    const result = await search.execute({ query: 'latest Mastra release', sources: ['web'] }, {});
    await mcp.disconnect();
    expect(JSON.stringify(result)).toContain(MOCK_RESULT.url);
    expect(JSON.parse(result.content[0].text)).toEqual(searchResponse());
  });

  // biome-ignore lint/suspicious/noExplicitAny: MCP tool schemas and results are untyped
  const offered = async (): Promise<Record<string, any>> => {
    const mcp = client();
    const tools = await loadFirecrawlTools(mcp);
    return { ...tools, disconnect: () => mcp.disconnect() };
  };

  it('the offered schemas carry no paid, page-acting or Alexandria inputs', async () => {
    const tools = await offered();
    await tools.disconnect();
    for (const name of FIRECRAWL_TOOLS) {
      const schema = JSON.stringify(tools[name].inputSchema);
      for (const key of REMOVED_INPUTS) expect(schema).not.toContain(`"${key}"`);
      expect(schema).not.toContain('"alexandria"');
      expect(schema).not.toContain('"exchange"');
    }
  });

  it('scrape rejects alexandria, actions, profile and proxy before anything reaches Firecrawl', async () => {
    const tools = await offered();
    const before = fc.calls.length;
    const url = 'https://example.com';
    for (const extra of [
      { alexandria: { provider: 'p', capability: 'c', options: {} } },
      { actions: [{ type: 'executeJavascript', script: 'alert(1)' }] },
      { profile: { name: 'saved', saveChanges: true } },
      { proxy: 'stealth' },
      { jsonOptions: { prompt: 'extract' } },
    ]) {
      const result = await tools.firecrawl_scrape.execute({ url, ...extra }, {});
      expect(result?.error, JSON.stringify(extra)).toBe(true);
    }
    // alexandria alone used to stand in for url; now url is required.
    const noUrl = await tools.firecrawl_scrape.execute({ alexandria: { provider: 'p' } }, {});
    expect(noUrl?.error).toBe(true);
    expect(fc.calls.length).toBe(before);

    // A plain page read still goes through.
    await tools.firecrawl_scrape.execute({ url, formats: ['markdown'] }, {});
    await tools.disconnect();
    expect(fc.calls.slice(before)).toEqual([
      { name: 'firecrawl_scrape', args: { url, formats: ['markdown'] } },
    ]);
  });

  it('search must name web-only sources, so Alexandria is never searched, even by default', async () => {
    const tools = await offered();
    const before = fc.calls.length;
    for (const input of [
      { query: 'q' }, // omitted: the server would default to web + alexandria
      { query: 'q', sources: ['alexandria'] },
      { query: 'q', sources: [{ type: 'exchange' }] },
      { query: 'q', sources: ['web'], domainTools: true },
      { query: 'q', sources: ['web'], scrapeOptions: { actions: [{ type: 'click' }] } },
    ]) {
      const result = await tools.firecrawl_search.execute(input, {});
      expect(result?.error, JSON.stringify(input)).toBe(true);
    }
    expect(fc.calls.length).toBe(before);

    await tools.firecrawl_search.execute({ query: 'q', sources: ['web', 'news'] }, {});
    await tools.disconnect();
    expect(fc.calls.slice(before)).toEqual([
      { name: 'firecrawl_search', args: { query: 'q', sources: ['web', 'news'] } },
    ]);
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
      await expect(search.execute({ query: 'x', sources: ['web'] }, {})).rejects.toThrow(
        'Insufficient credits',
      );
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

describe('a failing endpoint is not asked again on every run', () => {
  it('after a failed discovery, runs skip Firecrawl for the backoff, then retry', async () => {
    // An endpoint that answers every request with a 500 (and counts them).
    let hits = 0;
    const down = createServer((_req, res) => {
      hits += 1;
      res.writeHead(500);
      res.end();
    });
    await new Promise<void>((resolve) => down.listen(0, '127.0.0.1', resolve));
    const { port } = down.address() as AddressInfo;

    vi.stubEnv('FIRECRAWL_API_KEY', 'fc-test-key');
    vi.stubEnv('FIRECRAWL_MCP_URL', `http://127.0.0.1:${port}/mcp`);
    vi.resetModules();
    const live = await import('../../src/mastra/lib/firecrawl');
    let clock = 1_000_000;
    const now = () => clock;
    try {
      expect(await live.getFirecrawlTools(now)).toEqual({});
      const afterFirst = hits;
      expect(afterFirst).toBeGreaterThan(0);

      // Within the backoff: no request at all.
      clock += live.DISCOVERY_BACKOFF_MS - 1;
      expect(await live.getFirecrawlTools(now)).toEqual({});
      expect(hits).toBe(afterFirst);

      // Past it: discovery runs again.
      clock += 2;
      await live.getFirecrawlTools(now);
      expect(hits).toBeGreaterThan(afterFirst);
    } finally {
      await live.disconnectFirecrawl();
      vi.unstubAllEnvs();
      vi.resetModules();
      await new Promise<void>((resolve) => {
        down.close(() => resolve());
        down.closeAllConnections();
      });
    }
  });
});
