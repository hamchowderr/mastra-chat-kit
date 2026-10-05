import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentController, Session } from '@mastra/core/agent-controller';
import { InMemoryStore } from '@mastra/core/storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type FirecrawlMock,
  MOCK_RESULT,
  OUT_OF_CREDITS,
  searchResponse,
  startFirecrawlMock,
} from '../../scripts/firecrawl-mock';

/**
 * Firecrawl web search end to end: the real AgentController and chat agent on AIMock,
 * with Firecrawl's MCP server mocked by AIMock's MCPMock (scripts/firecrawl-mock.ts).
 * Configured the way the owner's client runs the kit: FIRECRAWL_API_KEY set and the
 * sandbox off (WORKSPACE_SANDBOX=false), so there is no browser either and Firecrawl is
 * the only way to the web.
 */

let fc: FirecrawlMock;
let root: string;
let controller: AgentController;
let AUTO_ALLOWED_TOOLS: readonly string[] = [];
let disconnectFirecrawl: () => Promise<void>;
let getFirecrawlTools: () => Promise<Record<string, unknown>>;

beforeAll(async () => {
  fc = await startFirecrawlMock();
  root = mkdtempSync(path.join(tmpdir(), 'firecrawl-'));
  vi.stubEnv('FIRECRAWL_API_KEY', 'fc-test-key');
  vi.stubEnv('FIRECRAWL_MCP_URL', fc.url);
  vi.stubEnv('WORKSPACE_SANDBOX', 'false');
  vi.stubEnv('WORKSPACE_ROOT', root);
  // Dynamic imports: env.ts reads process.env once, when it first loads.
  const ac = await import('../../src/mastra/lib/agent-controller');
  ({ disconnectFirecrawl, getFirecrawlTools } = await import('../../src/mastra/lib/firecrawl'));
  AUTO_ALLOWED_TOOLS = ac.AUTO_ALLOWED_TOOLS;
  controller = ac.createChatAgentController({
    storage: new InMemoryStore(),
    resourceId: 'u-firecrawl',
  });
  await controller.init();
}, 60_000);

afterAll(async () => {
  await controller?.destroy();
  await disconnectFirecrawl?.();
  await fc?.stop();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

/** The tool names each model request offered (AIMock's journal only keeps the text). */
function spyOnOfferedTools() {
  const offered: string[][] = [];
  const realFetch = globalThis.fetch;
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/v1/messages') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as { tools?: { name: string }[] };
      if (body.tools?.length) offered.push(body.tools.map((t) => t.name));
    }
    return realFetch(input, init);
  });
  return { offered, restore: () => spy.mockRestore() };
}

/** Send one message on a fresh thread and collect its events. Approves any gate. */
async function turn(content: string, threadTitle: string) {
  const session: Session = await controller.createSession({ resourceId: 'u-firecrawl' });
  for (const tool of AUTO_ALLOWED_TOOLS) session.grantTool(tool);
  // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide; we assert on .type
  const events: any[] = [];
  const approvals: string[] = [];
  const unsubscribe = session.subscribe((e) => {
    events.push(e);
    if (e.type === 'tool_approval_required') {
      approvals.push(e.toolName);
      session.respondToToolApproval({ decision: 'approve' });
    }
  });
  await session.thread.create({ title: threadTitle });
  await session.sendMessage({ content });
  unsubscribe();
  return { events, approvals, blob: JSON.stringify(events) };
}

describe('Firecrawl web search (AIMock + mocked Firecrawl MCP, sandbox off)', () => {
  it('the agent searches with firecrawl_search and answers from the result, with no approval card', async () => {
    const { offered, restore } = spyOnOfferedTools();
    const { events, approvals, blob } = await turn(
      'Search the web for the latest Mastra release.',
      'search',
    ).finally(restore);

    // Offered: the two Firecrawl tools, none of the other ~25, and no shell.
    expect(offered[0]).toEqual(expect.arrayContaining(['firecrawl_search', 'firecrawl_scrape']));
    for (const absent of [
      'firecrawl_crawl',
      'firecrawl_agent',
      'firecrawl_map',
      'mastra_workspace_execute_command',
    ]) {
      expect(offered[0]).not.toContain(absent);
    }

    // Ran without a gate, and Firecrawl's result went back to the model.
    expect(approvals).toEqual([]);
    const end = events.find((e) => e.type === 'tool_end');
    expect(end.isError).toBe(false);
    expect(JSON.stringify(end.result)).toContain(MOCK_RESULT.url);
    // The answer fixture only matches when the tool result carries the mocked URL.
    expect(blob).toContain('The latest Mastra release is **1.70**');
  });

  it('a Firecrawl error reaches the agent as a tool error and the run still finishes', async () => {
    fc.mock.onToolCall('firecrawl_search', () => {
      throw new Error(OUT_OF_CREDITS);
    });
    try {
      const { events, blob } = await turn("Search the web for Firecrawl's pricing page.", 'error');
      const end = events.find((e) => e.type === 'tool_end');
      expect(end.isError).toBe(true);
      expect(JSON.stringify(end.result)).toContain('Insufficient credits');
      expect(blob).toContain('Firecrawl reports the account is out of credits');
      expect(events.some((e) => e.type === 'agent_end')).toBe(true);
    } finally {
      fc.mock.onToolCall('firecrawl_search', () => JSON.stringify(searchResponse()));
    }
  });

  it('the research subagent is offered and searches with Firecrawl', async () => {
    const { offered, restore } = spyOnOfferedTools();
    const { events, approvals, blob } = await turn(
      'Have the research subagent find the latest Mastra release.',
      'research',
    ).finally(restore);

    // Delegating is still gated; the specialist's Firecrawl calls run inside it.
    expect(approvals).toEqual(['subagent']);
    const sub = events.find((e) => e.type === 'subagent_tool_end');
    expect(sub.subToolName).toBe('firecrawl_search');
    expect(sub.isError).toBe(false);
    expect(JSON.stringify(sub.subToolResult)).toContain(MOCK_RESULT.url);
    expect(events.find((e) => e.type === 'subagent_end').isError).toBe(false);
    expect(blob).toContain('The research subagent found that Mastra 1.70');

    // The specialist's own request offered Firecrawl (through allowedControllerTools).
    const specialist = offered.find((names) => !names.includes('subagent'));
    expect(specialist).toEqual(expect.arrayContaining(['firecrawl_search', 'firecrawl_scrape']));
  });

  // Mastra's shutdown() (the server runs it on SIGINT/SIGTERM) destroys every registered
  // controller; destroying ours must close the Firecrawl connection.
  it('destroying the controller disconnects Firecrawl', async () => {
    expect(Object.keys(await getFirecrawlTools())).toHaveLength(2);
    const requests = fc.authorizations().length;
    // Connected and cached: asking again sends nothing.
    await getFirecrawlTools();
    expect(fc.authorizations().length).toBe(requests);

    await controller.destroy();
    // The cache and connection are gone, so the next ask connects and lists again.
    const afterDestroy = fc.authorizations().length;
    expect(Object.keys(await getFirecrawlTools())).toHaveLength(2);
    expect(fc.authorizations().length).toBeGreaterThan(afterDestroy);
  });
});
