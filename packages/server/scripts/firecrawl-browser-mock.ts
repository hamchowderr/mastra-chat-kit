/**
 * Firecrawl's Browser Sandbox API, mocked, for the tests and for a local run with no
 * Firecrawl account and no credits spent.
 *
 * It answers the calls `@mastra/browser-firecrawl` makes through the Firecrawl JS SDK
 * (firecrawl@4: `browser()`, `deleteBrowser()`, `listBrowsers()`):
 *   POST   /v2/browser      create a session → { success, id, cdpUrl, liveViewUrl, expiresAt }
 *   DELETE /v2/browser/:id  close it
 *   GET    /v2/browser      list them
 * Each session is a real headless Chrome on this machine, started with a CDP port, and
 * its `cdpUrl` is that Chrome's DevTools WebSocket. So the provider's CDP side
 * (Playwright connectOverCDP, snapshots, clicks, the screencast) runs for real; only
 * Firecrawl's HTTP API and its hosting are mocked.
 *
 * Chrome comes from BROWSER_EXECUTABLE_PATH, else Playwright's Chromium
 * (`pnpm --filter @mastra-chat-kit/server setup:browser`), else an installed Chrome.
 *
 * Run it on its own (it prints the URL to put in FIRECRAWL_API_URL):
 *   pnpm --filter @mastra-chat-kit/server exec tsx scripts/firecrawl-browser-mock.ts [port]
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

/** The key the mock accepts (any other gets a 401, as Firecrawl answers a bad key). */
export const MOCK_API_KEY = 'fc-test-key';

/** A page for the agent to browse, as a data: URL so no server or network is needed. */
export const DEMO_PAGE_HTML =
  '<title>Firecrawl browser demo</title><h1>Mastra newsletter</h1><p id="status">Not signed up yet</p><label>Email <input type="email"></label><button onclick="document.getElementById(\'status\').textContent=\'Signed up\'">Sign up</button>';
export const DEMO_PAGE_URL = `data:text/html,${encodeURIComponent(DEMO_PAGE_HTML)}`;

export type MockSession = {
  id: string;
  /** The body of the create call (ttl, activityTtl, …). */
  options: Record<string, unknown>;
  createdAt: number;
  deletedAt?: number;
};

/** A Chrome to stand in for Firecrawl's hosted browser. */
function chromePath(): string {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    chromium.executablePath(),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) {
    throw new Error(
      'firecrawl-browser-mock needs a Chrome: set BROWSER_EXECUTABLE_PATH, or run `pnpm --filter @mastra-chat-kit/server setup:browser`',
    );
  }
  return found;
}

/** Start a headless Chrome with a CDP port and return its DevTools WebSocket URL. */
async function startChrome(): Promise<{ chrome: ChildProcess; profile: string; cdpUrl: string }> {
  const profile = mkdtempSync(path.join(tmpdir(), 'fc-browser-mock-'));
  const chrome = spawn(
    chromePath(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  // Chrome writes the port it picked, and the browser target's path, to this file.
  const portFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited with code ${chrome.exitCode}`);
    if (existsSync(portFile)) {
      const [port, target] = readPortFile(portFile);
      // Ready once its first tab is a target: Playwright's CDP connect wants a page, as a
      // hosted session has one.
      if (port && target && (await hasPage(port))) {
        return { chrome, profile, cdpUrl: `ws://127.0.0.1:${port}${target}` };
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  stopChrome(chrome, profile);
  throw new Error('Chrome did not open a CDP port within 15s');
}

/** The port and target lines, or none while Chrome still holds the file (Windows locks it). */
function readPortFile(file: string): string[] {
  try {
    return readFileSync(file, 'utf8').trim().split(/\r?\n/);
  } catch {
    return [];
  }
}

async function hasPage(port: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = (await res.json()) as { type: string }[];
    return targets.some((t) => t.type === 'page');
  } catch {
    return false;
  }
}

function stopChrome(chrome: ChildProcess, profile: string) {
  if (chrome.exitCode === null && chrome.pid) {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
    } else {
      chrome.kill('SIGKILL');
    }
  }
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* Windows may hold the profile a moment longer; it is in the temp folder */
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export type FirecrawlBrowserMock = {
  /** Base URL to use as FIRECRAWL_API_URL. */
  url: string;
  /** Every session created so far, open or closed. */
  sessions: () => MockSession[];
  /** The sessions still open. */
  open: () => MockSession[];
  /** Make the next create calls fail with this Firecrawl error (e.g. out of credits). */
  failCreate: (error: string | null) => void;
  stop: () => Promise<void>;
};

export async function startFirecrawlBrowserMock(port = 0): Promise<FirecrawlBrowserMock> {
  const sessions = new Map<string, MockSession>();
  const chromes = new Map<string, { chrome: ChildProcess; profile: string; cdpUrl: string }>();
  let createError: string | null = null;

  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${MOCK_API_KEY}`) {
      return send(401, { success: false, error: 'Unauthorized: Invalid token' });
    }
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'POST' && pathname === '/v2/browser') {
        const options = await readJson(req);
        if (createError) return send(402, { success: false, error: createError });
        const id = randomUUID();
        const started = await startChrome();
        chromes.set(id, started);
        const ttl = typeof options.ttl === 'number' ? options.ttl : 600;
        sessions.set(id, { id, options, createdAt: Date.now() });
        return send(200, {
          success: true,
          id,
          cdpUrl: started.cdpUrl,
          liveViewUrl: `http://127.0.0.1/live/${id}`,
          interactiveLiveViewUrl: `http://127.0.0.1/live/${id}?interactive=true`,
          expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        });
      }
      const match = pathname.match(/^\/v2\/browser\/([^/]+)$/);
      if (req.method === 'DELETE' && match) {
        const id = match[1] as string;
        const session = sessions.get(id);
        const started = chromes.get(id);
        if (!session || !started) return send(404, { success: false, error: 'Session not found' });
        chromes.delete(id);
        stopChrome(started.chrome, started.profile);
        session.deletedAt = Date.now();
        return send(200, { success: true });
      }
      if (req.method === 'GET' && pathname === '/v2/browser') {
        return send(200, {
          success: true,
          sessions: [...sessions.values()].map((s) => ({
            id: s.id,
            status: s.deletedAt ? 'destroyed' : 'active',
            cdpUrl: chromes.get(s.id)?.cdpUrl ?? '',
            createdAt: new Date(s.createdAt).toISOString(),
          })),
        });
      }
      return send(404, { success: false, error: `no mock for ${req.method} ${pathname}` });
    } catch (err) {
      return send(500, { success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: bound } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${bound}`,
    sessions: () => [...sessions.values()],
    open: () => [...sessions.values()].filter((s) => !s.deletedAt),
    failCreate: (error) => {
      createError = error;
    },
    stop: async () => {
      for (const [id, started] of chromes) {
        stopChrome(started.chrome, started.profile);
        chromes.delete(id);
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

// Run directly: serve on the given port (default 4013) until stopped.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mock = await startFirecrawlBrowserMock(Number(process.argv[2] ?? 4013));
  console.log(`Firecrawl browser mock on ${mock.url}`);
  console.log(`  FIRECRAWL_API_URL=${mock.url}  FIRECRAWL_API_KEY=${MOCK_API_KEY}`);
  const shutdown = async () => {
    await mock.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
