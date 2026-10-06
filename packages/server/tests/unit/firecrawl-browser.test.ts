import type { AgentController, Session } from '@mastra/core/agent-controller';
import type { MastraBrowser } from '@mastra/core/browser';
import { describe, expect, it, vi } from 'vitest';
import { closeRunSessions } from '../../src/mastra/lib/firecrawl-browser';

/** A browser with an open session on each of `open`, recording what it closes. */
function fakeBrowser(open: string[]) {
  const closed: string[] = [];
  const browser = {
    hasThreadSession: (id: string) => open.includes(id),
    isBrowserRunning: (id: string) => open.includes(id),
    closeThreadSession: async (id: string) => {
      closed.push(id);
    },
  } as unknown as MastraBrowser;
  return { browser, closed };
}

const session = {
  thread: { getId: () => 'current' },
  identity: { getResourceId: () => 'user-1' },
} as unknown as Session;

describe('closeRunSessions', () => {
  it("closes the run's thread and the user's forked threads that have a session", async () => {
    const { browser, closed } = fakeBrowser(['current', 'fork-1']);
    const controller = {
      queryThreads: vi.fn(async () => [{ id: 'fork-1' }, { id: 'other' }]),
    } as unknown as AgentController;
    await closeRunSessions(controller, session, browser);
    expect(closed.sort()).toEqual(['current', 'fork-1']);
    expect(controller.queryThreads).toHaveBeenCalledWith({
      resourceId: 'user-1',
      includeForkedSubagents: true,
    });
  });

  it("still closes the run's own thread when listing threads fails", async () => {
    const { browser, closed } = fakeBrowser(['current']);
    const controller = {
      queryThreads: async () => {
        throw new Error('storage down');
      },
    } as unknown as AgentController;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await closeRunSessions(controller, session, browser);
    warn.mockRestore();
    expect(closed).toEqual(['current']);
  });
});
