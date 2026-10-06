import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FirecrawlMock, startFirecrawlMock } from '../../scripts/firecrawl-mock';
import { chatTools } from '../../src/mastra/agents/chat';
import { AUTO_ALLOWED_TOOLS, chatSubagents } from '../../src/mastra/lib/agent-controller';
import { FULL_FEATURES, resolveFeatures } from '../../src/mastra/lib/features';
import { createFirecrawlClient, loadFirecrawlTools } from '../../src/mastra/lib/firecrawl';
import { createFirecrawlBrowser } from '../../src/mastra/lib/firecrawl-browser';
import {
  BROWSER_ACTION_TOOLS,
  BROWSER_AUTO_ALLOWED_TOOLS,
  BROWSER_READ_TOOLS,
  CATEGORIZED_TOOLS,
  FORKED_RUN_TOOLS,
  PLAN_MODE_TOOLS,
  READ_TOOLS,
  resolveToolCategory,
} from '../../src/mastra/lib/tool-categories';

describe('resolveToolCategory — what "Always allow" grants', () => {
  it('puts lookups in read, file changes in edit, shell in execute', () => {
    expect(resolveToolCategory('getWeather')).toBe('read');
    expect(resolveToolCategory(WORKSPACE_TOOLS.FILESYSTEM.READ_FILE)).toBe('read');
    expect(resolveToolCategory(WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE)).toBe('edit');
    expect(resolveToolCategory(WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND)).toBe('execute');
  });

  it('never lets delete ride on an edit grant', () => {
    expect(resolveToolCategory(WORKSPACE_TOOLS.FILESYSTEM.DELETE)).toBeNull();
  });

  it('keeps goals, schedules and subagents off the image grant', () => {
    expect(resolveToolCategory('generateImage')).toBe('other');
    for (const tool of ['setGoal', 'start_schedule', 'stop_schedule', 'subagent']) {
      expect(resolveToolCategory(tool)).toBeNull();
    }
  });

  it('leaves unknown tools uncategorized, so no existing grant covers them', () => {
    expect(resolveToolCategory('some_new_mcp_tool')).toBeNull();
  });
});

/**
 * The tool categories, the auto-allowed tools and the agent's instructions all use the
 * name the model is offered: the key a tool is registered under. A name that matches no
 * tool categorizes nothing, so "Always allow read" and the Plan allowlist would silently
 * miss the tool (the schedule tools were once keyed `listSchedules` while everything
 * else said `list_schedules`). This pins every name to a real one.
 */

// The controller's Firecrawl tools, as listed by a mocked Firecrawl MCP server that
// advertises the real firecrawl-mcp tool list (scripts/firecrawl-mock.ts).
let fc: FirecrawlMock;
let firecrawlNames: string[] = [];
beforeAll(async () => {
  fc = await startFirecrawlMock();
  const client = createFirecrawlClient({ apiKey: 'fc-test-key', url: fc.url, id: 'categories' });
  firecrawlNames = Object.keys(await loadFirecrawlTools(client));
  await client.disconnect();
});
afterAll(async () => {
  await fc.stop();
});

// The Firecrawl browser's tools, as the provider lists them (building it calls nothing).
const browserNames = Object.keys(
  createFirecrawlBrowser({
    apiKey: 'fc-test-key',
    apiUrl: 'http://127.0.0.1:9',
    ttl: 600,
    activityTtl: 300,
  }).getTools(),
);

/** Every tool name the agent, a specialist, the controller or the workspace can expose. */
function exposedToolNames(): Set<string> {
  const full = resolveFeatures(FULL_FEATURES, { dolt: true });
  const names = new Set<string>([
    ...Object.keys(chatTools(full)),
    ...firecrawlNames,
    ...browserNames,
  ]);
  for (const sub of chatSubagents(full)) {
    for (const name of Object.keys(sub.tools ?? {})) names.add(name);
  }
  for (const group of Object.values(WORKSPACE_TOOLS)) {
    for (const name of Object.values(group as Record<string, string>)) names.add(name);
  }
  return names;
}

// The controller's own tools, which no agent or workspace registers.
const CONTROLLER_TOOLS = [
  'ask_user',
  'submit_plan',
  'task_write',
  'task_update',
  'task_complete',
  'task_check',
];

describe('tool names match what the agent is offered', () => {
  it('every categorized name is a tool the agent really exposes', () => {
    const exposed = exposedToolNames();
    expect(CATEGORIZED_TOOLS.filter((name) => !exposed.has(name))).toEqual([]);
  });

  it('every auto-allowed name is a tool the agent exposes, or a controller tool', () => {
    const exposed = exposedToolNames();
    expect(
      AUTO_ALLOWED_TOOLS.filter((n) => !exposed.has(n) && !CONTROLLER_TOOLS.includes(n)),
    ).toEqual([]);
  });

  it('the schedule tools are offered under their ids', () => {
    expect(Object.keys(chatTools(FULL_FEATURES))).toEqual(
      expect.arrayContaining(['start_schedule', 'stop_schedule', 'list_schedules']),
    );
  });

  it('list_schedules is a read tool, so Always allow read and Plan mode cover it', () => {
    expect(resolveToolCategory('list_schedules')).toBe('read');
    expect(READ_TOOLS).toContain('list_schedules');
    expect(PLAN_MODE_TOOLS).toContain('list_schedules');
  });
});

describe('Firecrawl tools skip the approval card and work in Plan mode', () => {
  it('search and scrape are read tools, auto-allowed, and in the Plan allowlist', () => {
    expect([...firecrawlNames].sort()).toEqual(['firecrawl_scrape', 'firecrawl_search']);
    for (const name of firecrawlNames) {
      expect(resolveToolCategory(name)).toBe('read');
      expect(AUTO_ALLOWED_TOOLS).toContain(name);
      expect(PLAN_MODE_TOOLS).toContain(name);
    }
  });
});

describe('Firecrawl browser tools: reads in read, actions ask every time', () => {
  // The lists are plain names (so the categories never load the provider); this pins
  // them to the provider's real toolset.
  it('every browser tool the provider offers is sorted into reads or actions, and evaluate is not offered', () => {
    const sorted = [...BROWSER_READ_TOOLS, ...BROWSER_ACTION_TOOLS, 'browser_close'];
    expect([...browserNames].sort()).toEqual([...sorted].sort());
    expect(browserNames).not.toContain('browser_evaluate');
  });

  it('reads are in read and the Plan allowlist; only browser_goto among them asks first', () => {
    for (const name of BROWSER_READ_TOOLS) {
      expect(resolveToolCategory(name)).toBe('read');
      expect(PLAN_MODE_TOOLS).toContain(name);
    }
    expect(AUTO_ALLOWED_TOOLS).not.toContain('browser_goto');
    for (const name of BROWSER_AUTO_ALLOWED_TOOLS) expect(AUTO_ALLOWED_TOOLS).toContain(name);
  });

  it('actions have no category, are never auto-allowed, and are not in Plan mode or a forked run', () => {
    for (const name of BROWSER_ACTION_TOOLS) {
      expect(resolveToolCategory(name)).toBeNull();
      expect(AUTO_ALLOWED_TOOLS).not.toContain(name);
      expect(PLAN_MODE_TOOLS).not.toContain(name);
      expect(FORKED_RUN_TOOLS).not.toContain(name);
    }
  });

  it('a forked run gets no tool that would need an approval card', () => {
    for (const name of [
      'browser_goto',
      'mastra_workspace_write_file',
      'mastra_workspace_edit_file',
      'mastra_workspace_delete',
      'mastra_workspace_execute_command',
      'generateImage',
      'setGoal',
      'start_schedule',
      'subagent',
    ]) {
      expect(FORKED_RUN_TOOLS).not.toContain(name);
    }
    expect(FORKED_RUN_TOOLS).toEqual(
      expect.arrayContaining([
        'browser_snapshot',
        'firecrawl_scrape',
        'mastra_workspace_read_file',
      ]),
    );
  });
});
