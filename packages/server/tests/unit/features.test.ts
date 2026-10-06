import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { chatInstructions, chatTools, webSearchInstructions } from '../../src/mastra/agents/chat';
import { chatSubagents, PLAN_MODE_INSTRUCTIONS } from '../../src/mastra/lib/agent-controller';
import {
  type ChatFeatures,
  FULL_FEATURES,
  resolveBrowser,
  resolveFeatures,
} from '../../src/mastra/lib/features';
import { FIRECRAWL_TOOLS } from '../../src/mastra/lib/firecrawl';
import { createChatWorkspace } from '../../src/mastra/lib/workspace';

/**
 * The feature switches (lib/features.ts). Defaults are the full kit, so these pin both
 * halves: nothing changes for a server with no switches set, and each switch removes
 * exactly its piece — from the tools, the roster, the workspace AND the instructions.
 * A specialist is only offered when what it works with is there.
 */

const ids = (f: ChatFeatures) => chatSubagents(f).map((s) => s.id);

describe('feature switches — defaults', () => {
  it('the env defaults are the full kit, minus what needs an outside service the tests do not run (Dolt, a Firecrawl key)', async () => {
    const { features } = await import('../../src/mastra/lib/features');
    expect(features).toEqual(
      resolveFeatures({ ...FULL_FEATURES, firecrawl: false }, { dolt: false }),
    );
  });

  it('the full kit keeps every tool and specialist', () => {
    const f = resolveFeatures(FULL_FEATURES, { dolt: true });
    expect(Object.keys(chatTools(f))).toEqual(
      expect.arrayContaining(['getWeather', 'searchKnowledge', 'generateImage', 'setGoal']),
    );
    expect(ids(f)).toEqual(['code', 'research', 'writer', 'review', 'data']);
  });

  it('data needs Dolt', () => {
    expect(ids(resolveFeatures(FULL_FEATURES, { dolt: false }))).not.toContain('data');
  });

  it('code needs the sandbox', () => {
    const noSandbox = resolveFeatures({ ...FULL_FEATURES, sandbox: false }, { dolt: false });
    expect(ids(noSandbox)).not.toContain('code');
    const noBrowser = resolveFeatures({ ...FULL_FEATURES, browser: false }, { dolt: false });
    expect(ids(noBrowser)).toContain('code');
  });

  // @mastra/browser-viewer gives the agent no browser tools: it drives Chrome with the
  // browser CLI through execute_command. Without the sandbox the viewer can't be used.
  it('the viewer needs the sandbox', () => {
    const noFirecrawl = { ...FULL_FEATURES, firecrawl: false };
    expect(resolveFeatures({ ...noFirecrawl, sandbox: false }, { dolt: false }).browser).toBe(
      false,
    );
    expect(resolveFeatures(noFirecrawl, { dolt: false }).browser).toBe('viewer');
  });

  it('research needs the live web: Firecrawl, or the browser (which needs the sandbox)', () => {
    const research = (f: Partial<ChatFeatures>) =>
      ids(resolveFeatures({ ...FULL_FEATURES, ...f }, { dolt: false })).includes('research');
    // The owner's client: sandbox off, Firecrawl on.
    expect(research({ sandbox: false, firecrawl: true })).toBe(true);
    expect(research({ sandbox: false, browser: false, firecrawl: true })).toBe(true);
    // The browser alone, with the sandbox to drive it.
    expect(research({ firecrawl: false })).toBe(true);
    // A browser with no sandbox is no way to the web.
    expect(research({ sandbox: false, firecrawl: false })).toBe(false);
    expect(research({ browser: false, firecrawl: false })).toBe(false);
  });
});

describe('feature switches — which browser (BROWSER_PROVIDER)', () => {
  const pick = (browser: ChatFeatures['browser'], sandbox: boolean, firecrawl: boolean) =>
    resolveBrowser({ browser, sandbox, firecrawl });

  it('auto: Firecrawl when the key is set and the sandbox is off, else the viewer with the sandbox, else none', () => {
    expect(pick('auto', false, true)).toBe('firecrawl');
    expect(pick('auto', true, true)).toBe('viewer');
    expect(pick('auto', true, false)).toBe('viewer');
    expect(pick('auto', false, false)).toBe(false);
  });

  it('an explicit provider is used only when what it needs is there', () => {
    expect(pick('firecrawl', true, true)).toBe('firecrawl');
    expect(pick('firecrawl', false, true)).toBe('firecrawl');
    expect(pick('firecrawl', true, false)).toBe(false);
    expect(pick('viewer', true, true)).toBe('viewer');
    expect(pick('viewer', false, true)).toBe(false);
  });

  it('WORKSPACE_BROWSER=false turns the browser off whatever else is set', () => {
    for (const sandbox of [true, false]) {
      for (const firecrawl of [true, false]) expect(pick(false, sandbox, firecrawl)).toBe(false);
    }
  });

  it('the env picks the provider the same way', async () => {
    const { features } = await import('../../src/mastra/lib/features');
    const { env } = await import('../../src/lib/env');
    // The test env: no Firecrawl key, the sandbox on, BROWSER_PROVIDER unset.
    expect(env.BROWSER_PROVIDER).toBeUndefined();
    expect(features.browser).toBe('viewer');
  });

  it('research is offered with the Firecrawl browser, and reads pages with Firecrawl, not the browser', () => {
    const f = resolveFeatures(
      { ...FULL_FEATURES, sandbox: false, browser: 'firecrawl' },
      { dolt: false },
    );
    const research = chatSubagents(f).find((s) => s.id === 'research');
    expect(research?.allowedControllerTools).toEqual([...FIRECRAWL_TOOLS]);
    expect(Object.keys(research?.tools ?? {}).filter((t) => t.startsWith('browser_'))).toEqual([]);
  });

  it('the agent hears about the browser tools only when the Firecrawl browser is on', () => {
    const on = resolveFeatures(
      { ...FULL_FEATURES, sandbox: false, browser: 'firecrawl' },
      { dolt: false },
    );
    const off = resolveFeatures(
      { ...FULL_FEATURES, sandbox: false, browser: false },
      { dolt: false },
    );
    expect(chatInstructions(on)).toContain('browser_goto');
    expect(webSearchInstructions(on)).toContain('browser_goto');
    expect(chatInstructions(off)).not.toContain('browser_');
    expect(webSearchInstructions(off)).not.toContain('browser');
    // The viewer keeps its own text, which names no browser_* tool.
    const viewer = resolveFeatures({ ...FULL_FEATURES, firecrawl: false }, { dolt: false });
    expect(chatInstructions(viewer)).not.toContain('browser_');
  });
});

describe('feature switches — Firecrawl', () => {
  const sandboxOff = resolveFeatures(
    { ...FULL_FEATURES, sandbox: false, firecrawl: true },
    { dolt: false },
  );

  it('the research subagent takes the Firecrawl tools from the controller', () => {
    const research = chatSubagents(sandboxOff).find((s) => s.id === 'research');
    expect(research?.allowedControllerTools).toEqual([...FIRECRAWL_TOOLS]);
    expect(String(research?.instructions)).toContain('firecrawl_search');
    expect(String(research?.instructions)).not.toContain('browser');
  });

  it('without Firecrawl the research subagent reads the web with the browser', () => {
    const f = resolveFeatures({ ...FULL_FEATURES, firecrawl: false }, { dolt: false });
    const research = chatSubagents(f).find((s) => s.id === 'research');
    expect(research?.allowedControllerTools).toBeUndefined();
    expect(String(research?.instructions)).toContain('browser tools');
  });

  it('the Search toggle points at Firecrawl when it is on, else the browser, else adds nothing', () => {
    expect(webSearchInstructions(sandboxOff)).toContain('firecrawl_search');
    // Firecrawl wins even when the browser is there too.
    expect(webSearchInstructions(resolveFeatures(FULL_FEATURES, { dolt: false }))).toContain(
      'firecrawl_search',
    );
    const browserOnly = resolveFeatures({ ...FULL_FEATURES, firecrawl: false }, { dolt: false });
    expect(webSearchInstructions(browserOnly)).toContain('browser tools');
    const neither = resolveFeatures(
      { ...FULL_FEATURES, firecrawl: false, sandbox: false },
      { dolt: false },
    );
    expect(webSearchInstructions(neither)).toBe('');
  });
});

describe('feature switches — a narrow assistant', () => {
  const narrow = resolveFeatures(
    {
      sandbox: false,
      browser: false,
      firecrawl: false,
      subagents: { code: true, research: true, writer: true, review: false, data: true },
      generateImage: false,
      demoTools: false,
    },
    { dolt: false },
  );

  it('keeps only what can work without a sandbox, browser, Firecrawl or Dolt (review switched off): the writer', () => {
    expect(ids(narrow)).toEqual(['writer']);
  });

  it('drops the demo tools and image generation', () => {
    const tools = Object.keys(chatTools(narrow));
    for (const absent of ['getWeather', 'searchKnowledge', 'generateImage']) {
      expect(tools).not.toContain(absent);
    }
    const text = chatInstructions(narrow);
    for (const absent of ['getWeather', 'searchKnowledge', 'generateImage']) {
      expect(text).not.toContain(absent);
    }
  });

  it('research loses searchKnowledge when the demo tools are off', () => {
    const f = resolveFeatures({ ...FULL_FEATURES, demoTools: false }, { dolt: false });
    const research = chatSubagents(f).find((s) => s.id === 'research');
    expect(Object.keys(research?.tools ?? {})).toEqual([]);
  });

  it('a full workspace can drop just the sandbox', () => {
    const ws = createChatWorkspace({
      root: tmpdir(),
      features: resolveFeatures({ ...FULL_FEATURES, sandbox: false }, { dolt: false }),
    });
    expect(ws.filesystem).toBeDefined();
    expect(ws.sandbox).toBeUndefined();
  });
});

describe('plan mode', () => {
  // Mastra's submit_plan takes the PATH of a plan file the agent wrote, so both the chat
  // instructions and Plan mode's own name the exact workspace tool to write it with.
  it('writes the plan with write_file and submits its path', () => {
    for (const text of [PLAN_MODE_INSTRUCTIONS, chatInstructions(FULL_FEATURES)]) {
      expect(text).toContain('mastra_workspace_write_file');
      expect(text).toContain('submit_plan');
      expect(text).toContain('plans/');
    }
  });

  it('the workspace keeps its file tools with the sandbox and browser off', () => {
    const ws = createChatWorkspace({
      root: tmpdir(),
      features: resolveFeatures(
        { ...FULL_FEATURES, sandbox: false, browser: false },
        { dolt: false },
      ),
    });
    expect(ws.filesystem).toBeDefined();
    expect(ws.sandbox).toBeUndefined();
    expect(ws.browser).toBeUndefined();
  });
});
