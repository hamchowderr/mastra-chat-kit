import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentController, Session } from '@mastra/core/agent-controller';
import type { MastraBrowser } from '@mastra/core/browser';
import { InMemoryStore } from '@mastra/core/storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type FirecrawlBrowserMock,
  MOCK_API_KEY,
  startFirecrawlBrowserMock,
} from '../../scripts/firecrawl-browser-mock';
import { type FirecrawlMock, startFirecrawlMock } from '../../scripts/firecrawl-mock';

/**
 * The Firecrawl hosted browser end to end (BROWSER_PROVIDER unset, so `auto` picks it:
 * the Firecrawl key is set and the sandbox is off). The real AgentController and chat
 * agent run on AIMock; Firecrawl's browser API is mocked by
 * scripts/firecrawl-browser-mock.ts, whose sessions are local headless Chromes reached
 * over CDP exactly as the provider reaches a hosted one. Firecrawl's search MCP server is
 * mocked too (the key turns search on as well).
 */

let browserMock: FirecrawlBrowserMock;
let searchMock: FirecrawlMock;
let root: string;
let controller: AgentController;
let browser: MastraBrowser;
let AUTO_ALLOWED_TOOLS: readonly string[] = [];
let firecrawlLiveView: typeof import('../../src/mastra/lib/firecrawl-browser').firecrawlLiveView;

beforeAll(async () => {
  browserMock = await startFirecrawlBrowserMock();
  searchMock = await startFirecrawlMock();
  root = mkdtempSync(path.join(tmpdir(), 'firecrawl-browser-'));
  vi.stubEnv('FIRECRAWL_API_KEY', MOCK_API_KEY);
  vi.stubEnv('FIRECRAWL_MCP_URL', searchMock.url);
  vi.stubEnv('FIRECRAWL_API_URL', browserMock.url);
  vi.stubEnv('WORKSPACE_SANDBOX', 'false');
  vi.stubEnv('WORKSPACE_ROOT', root);
  // Dynamic imports: env.ts reads process.env once, when it first loads.
  const ac = await import('../../src/mastra/lib/agent-controller');
  const fb = await import('../../src/mastra/lib/firecrawl-browser');
  const { features } = await import('../../src/mastra/lib/features');
  expect(features.browser).toBe('firecrawl');
  AUTO_ALLOWED_TOOLS = ac.AUTO_ALLOWED_TOOLS;
  firecrawlLiveView = fb.firecrawlLiveView;
  browser = fb.getFirecrawlBrowser();
  controller = ac.createChatAgentController({
    storage: new InMemoryStore(),
    resourceId: 'u-fc-browser',
  });
  await controller.init();
}, 60_000);

afterAll(async () => {
  await controller?.destroy();
  await browserMock?.stop();
  await searchMock?.stop();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
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

/**
 * Send one message on a fresh thread and collect its events. Each approval card is
 * answered by `decide` (approve by default), as the user would.
 */
async function turn(
  content: string,
  {
    mode = 'chat',
    decide = () => 'approve' as const,
  }: { mode?: string; decide?: (toolName: string) => 'approve' | 'decline' } = {},
) {
  const session: Session = await controller.createSession({ resourceId: 'u-fc-browser' });
  for (const tool of AUTO_ALLOWED_TOOLS) session.grantTool(tool);
  // biome-ignore lint/suspicious/noExplicitAny: AgentControllerEvent union is wide; we assert on .type
  const events: any[] = [];
  const approvals: string[] = [];
  const unsubscribe = session.subscribe((e) => {
    events.push(e);
    if (e.type === 'tool_approval_required') {
      approvals.push(e.toolName);
      session.respondToToolApproval({ decision: decide(e.toolName) });
    }
  });
  const thread = await session.thread.create({ title: content });
  // After the thread: a new thread starts in the default mode.
  await session.mode.switch({ modeId: mode });
  try {
    await session.sendMessage({ content });
  } finally {
    unsubscribe();
    await session.mode.switch({ modeId: 'chat' });
  }
  // The tools that really ran: ended without being denied at the approval gate.
  const names = new Map<string, string>(
    events.filter((e) => e.type === 'tool_start').map((e) => [e.toolCallId, e.toolName]),
  );
  const ran = events
    .filter((e) => e.type === 'tool_end' && !e.denied)
    .map((e) => names.get(e.toolCallId));
  return { events, approvals, ran, threadId: thread.id, blob: JSON.stringify(events) };
}

const ACTION_TOOLS = ['browser_click', 'browser_type', 'browser_press', 'browser_select'];

describe('Firecrawl hosted browser (AIMock + mocked Firecrawl browser API, sandbox off)', () => {
  it('a browse turn: the agent opens a page (asks) and reads it (does not), and the session closes when the run ends', async () => {
    const before = browserMock.sessions().length;
    const { offered, restore } = spyOnOfferedTools();
    const { approvals, ran, blob } = await turn(
      'Browse test: open the demo page and tell me what is on it.',
    ).finally(restore);

    // The provider's tools are offered, beside Firecrawl search, with no shell.
    expect(offered[0]).toEqual(
      expect.arrayContaining(['browser_goto', 'browser_snapshot', ...ACTION_TOOLS]),
    );
    expect(offered[0]).toEqual(expect.arrayContaining(['firecrawl_search', 'firecrawl_scrape']));
    expect(offered[0]).not.toContain('mastra_workspace_execute_command');
    // browser_evaluate (JavaScript in the page) is left out of the provider's toolset.
    expect(offered[0]).not.toContain('browser_evaluate');

    // Opening the site asked; reading it did not.
    expect(approvals).toEqual(['browser_goto']);
    expect(ran).toEqual(['browser_goto', 'browser_snapshot']);
    // The answer fixture only matches when the snapshot carries the real page's button.
    expect(blob).toContain('a Mastra newsletter sign-up');

    // One hosted session, created with the kit's caps, and closed by the end of the run.
    const created = browserMock.sessions().slice(before);
    expect(created).toHaveLength(1);
    expect(created[0]?.options).toMatchObject({ ttl: 600, activityTtl: 300 });
    expect(browserMock.open()).toEqual([]);
  });

  it('an action on the page asks for approval, and runs in the page once approved', async () => {
    const { approvals, ran, events, blob } = await turn('Browse test: sign up on the demo page.');

    expect(approvals).toEqual(['browser_goto', 'browser_click']);
    expect(ran).toEqual(['browser_goto', 'browser_snapshot', 'browser_click', 'browser_snapshot']);
    // The last snapshot is of the real page after the click.
    const check = events.filter((e) => e.type === 'tool_end').at(-1);
    expect(JSON.stringify(check.result)).toContain('Signed up');
    expect(blob).toContain('the page now says **Signed up**');
    expect(browserMock.open()).toEqual([]);
  });

  it('declining the action leaves the page alone', async () => {
    const { approvals, ran, blob } = await turn('Browse test: sign up on the demo page.', {
      decide: (tool) => (tool === 'browser_click' ? 'decline' : 'approve'),
    });

    expect(approvals).toEqual(['browser_goto', 'browser_click']);
    expect(ran.filter((t) => t === 'browser_snapshot')).toHaveLength(1);
    expect(blob).toContain('you declined the click');
    expect(browserMock.open()).toEqual([]);
  });

  it('Plan mode offers the read browser tools and none of the actions', async () => {
    const { offered, restore } = spyOnOfferedTools();
    const { approvals, ran, blob } = await turn(
      'Browse test: open the demo page and tell me what is on it.',
      { mode: 'plan' },
    ).finally(restore);

    // Every request of the Plan turn, including the step resumed after the browser_goto
    // approval (lib/tool-scope.ts keeps the allowlist there; the controller alone does not).
    expect(offered.length).toBeGreaterThan(1);
    for (const names of offered) {
      expect(names).toEqual(
        expect.arrayContaining(['browser_goto', 'browser_snapshot', 'browser_back']),
      );
      for (const action of [...ACTION_TOOLS, 'browser_close']) expect(names).not.toContain(action);
    }
    expect(approvals).toEqual(['browser_goto']);
    expect(ran).toEqual(['browser_goto', 'browser_snapshot']);
    expect(blob).toContain('a Mastra newsletter sign-up');
    expect(browserMock.open()).toEqual([]);
  });

  it('a forked subagent is not offered page actions, and its click does not run', async () => {
    const { offered, restore } = spyOnOfferedTools();
    const before = browserMock.sessions().length;
    const { approvals, events, blob } = await turn(
      'Browse test: have a forked subagent sign up on the demo page.',
    ).finally(restore);

    // Delegating asks; nothing inside the fork can.
    expect(approvals).toEqual(['subagent']);
    // The fork's own request: the chat agent's tools minus everything that would need
    // an approval card (lib/tool-scope.ts).
    const fork = offered.find((names) => !names.includes('subagent'));
    expect(fork).toBeDefined();
    expect(fork).toEqual(expect.arrayContaining(['browser_snapshot', 'firecrawl_scrape']));
    for (const hidden of [...ACTION_TOOLS, 'browser_goto', 'generateImage', 'setGoal']) {
      expect(fork).not.toContain(hidden);
    }
    // The fork still asked for the click, as a model might, but it never ran: no result
    // came back for it, and no browser session was opened.
    const started = events.filter((e) => e.type === 'subagent_tool_start');
    expect(started.map((e) => e.subToolName)).toEqual(['browser_click']);
    expect(events.filter((e) => e.type === 'subagent_tool_end')).toEqual([]);
    expect(browserMock.sessions()).toHaveLength(before);
    expect(blob).toContain('page actions are not available to it');
  });

  it('the Browser panel streams a thread’s open session, and never opens one itself', async () => {
    const noSession = firecrawlLiveView(browser, 'thread-without-a-browser');
    expect(noSession.isBrowserRunning()).toBe(false);
    await expect(noSession.launch()).rejects.toThrow('has not opened the browser');
    const opened = browserMock.sessions().length;
    expect(browserMock.sessions()).toHaveLength(opened);

    // The agent opens the browser on a thread (as browser_goto does) …
    browser.setCurrentThread('live-view-thread');
    await browser.ensureReady();
    const view = firecrawlLiveView(browser, 'live-view-thread');
    expect(view.isBrowserRunning()).toBe(true);
    // … and the panel gets frames of that page over the provider's CDP screencast.
    const stream = await view.startScreencast({
      format: 'jpeg',
      quality: 50,
      maxWidth: 640,
      maxHeight: 360,
    });
    const frame = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no screencast frame')), 15_000);
      stream.on('frame', (f: { data: string }) => {
        clearTimeout(timer);
        resolve(f.data);
      });
    });
    expect(frame.length).toBeGreaterThan(100);
    await stream.stop();
    await browser.closeThreadSession('live-view-thread');
    expect(browserMock.open()).toEqual([]);
  });

  // Mastra's shutdown() (the server runs it on SIGINT/SIGTERM) destroys every registered
  // controller; destroying ours must close every hosted session still open.
  it('destroying the controller closes every open session', async () => {
    for (const thread of ['left-open-1', 'left-open-2']) {
      browser.setCurrentThread(thread);
      await browser.ensureReady();
    }
    expect(browserMock.open()).toHaveLength(2);

    await controller.destroy();
    expect(browserMock.open()).toEqual([]);
  });
});
