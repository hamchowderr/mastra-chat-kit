import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { toUIMessage } from '../../src/mastra/lib/thread-utils';
import { threadLink, workThreadOf } from '../../src/mastra/lib/work-thread-info';
import { REPORT_EXCERPT_CHARS, reportText } from '../../src/mastra/lib/work-thread-text';
import { createWorkThreads } from '../../src/mastra/lib/work-threads';

describe('work thread info', () => {
  it('reads a work thread from its metadata and nothing else', () => {
    const info = { parentThreadId: 'm1', title: 'Plan', status: 'done' };
    expect(workThreadOf({ metadata: { workThread: info } })).toEqual(info);
    expect(workThreadOf({ metadata: {} })).toBeUndefined();
    expect(workThreadOf({ metadata: { workThread: { ...info, status: 'sleeping' } } })).toBe(
      undefined,
    );
    expect(workThreadOf(null)).toBeUndefined();
  });

  it('keeps its checklist, latest line, resolved flag and agent, dropping malformed ones', () => {
    const info = {
      parentThreadId: 'm1',
      title: 'Plan',
      status: 'done',
      latest: 'All set.',
      resolved: true,
      agent: { id: 'writer', name: 'Writer' },
      tasks: [
        { content: 'Draft it', status: 'completed' },
        { content: 'Bad', status: 'sleeping' },
        { status: 'pending' },
      ],
    };
    expect(workThreadOf({ metadata: { workThread: info } })).toEqual({
      ...info,
      tasks: [{ content: 'Draft it', status: 'completed' }],
    });
    const plain = workThreadOf({
      metadata: {
        workThread: { ...info, tasks: [], latest: '', resolved: 'yes', agent: { id: 'writer' } },
      },
    });
    expect(plain).toEqual({ parentThreadId: 'm1', title: 'Plan', status: 'done' });
  });

  it('links a thread by id, keeping the title from breaking the link', () => {
    expect(threadLink('a/b', 'Plan [v2]')).toBe('[Plan v2](#thread=a%2Fb)');
  });
});

describe('reports', () => {
  it('says what happened, with the reply trimmed', () => {
    expect(reportText('Plan', 't1', 'done', 'All set.')).toBe(
      '[Plan](#thread=t1) is done.\n\nAll set.',
    );
    expect(reportText('Plan', 't1', 'needs_you', 'it asked "Which list?"')).toBe(
      '[Plan](#thread=t1) needs you: it asked "Which list?"',
    );
    expect(reportText('Plan', 't1', 'failed')).toBe('[Plan](#thread=t1) stopped with an error.');
    const long = reportText('Plan', 't1', 'done', 'x'.repeat(REPORT_EXCERPT_CHARS + 50));
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThan(REPORT_EXCERPT_CHARS + 40);
  });
});

describe('toUIMessage', () => {
  it('restores the threads a start_thread call made, and no other tool call', () => {
    const ui = toUIMessage({
      id: 'a1',
      role: 'assistant',
      content: {
        format: 2,
        parts: [
          { type: 'text', text: 'Started it.' },
          {
            type: 'tool-invocation',
            toolInvocation: {
              state: 'result',
              toolCallId: 'c1',
              toolName: 'start_thread',
              args: { title: 'Plan', brief: '…' },
              result: { threadId: 't1', title: 'Plan', status: 'working' },
            },
          },
          {
            type: 'tool-invocation',
            toolInvocation: { state: 'result', toolCallId: 'c2', toolName: 'getWeather', args: {} },
          },
        ],
      },
    });
    expect(ui.parts).toEqual([
      { type: 'text', text: 'Started it.' },
      { type: 'data-work-thread', data: { threadId: 't1', title: 'Plan' } },
    ]);
  });
});

describe('start_thread approval', () => {
  const storage = {} as Parameters<typeof createWorkThreads>[0]['storage'];
  const getController = () => Promise.reject(new Error('unused'));

  it('leaves approval to the controller unless the host decides it', () => {
    const { tool } = createWorkThreads({ getController, storage });
    expect(typeof tool.requireApproval).not.toBe('function');
  });

  it("asks the host's rule with the starting run's request context", () => {
    const { tool } = createWorkThreads({
      getController,
      storage,
      requireApproval: (rc) => (rc as Map<string, unknown>).get('tainted') === true,
    });
    const ask = tool.requireApproval as (input: unknown, ctx: unknown) => boolean;
    expect(ask({}, { requestContext: new Map([['tainted', true]]) })).toBe(true);
    expect(ask({}, { requestContext: new Map() })).toBe(false);
  });

  it('asks the same rule before message_thread, and nothing before reading', () => {
    const { steering } = createWorkThreads({
      getController,
      storage,
      requireApproval: (rc) => (rc as Map<string, unknown>).get('tainted') === true,
    });
    const ask = steering.message_thread.requireApproval as (i: unknown, c: unknown) => boolean;
    expect(ask({}, { requestContext: new Map([['tainted', true]]) })).toBe(true);
    expect(ask({}, { requestContext: new Map() })).toBe(false);
    expect(steering.list_threads.requireApproval).toBeFalsy();
    expect(steering.read_thread.requireApproval).toBeFalsy();
  });
});

describe('start_thread agents', () => {
  const storage = {} as Parameters<typeof createWorkThreads>[0]['storage'];
  const getController = () => Promise.reject(new Error('unused'));
  const parses = (tool: { inputSchema?: unknown }, input: unknown) =>
    (tool.inputSchema as z.ZodType).safeParse(input).success;

  it("offers the host's agents by id, and none without them", () => {
    const plain = createWorkThreads({ getController, storage }).tool;
    expect(parses(plain, { title: 'T', brief: 'B', agent: 'x' })).toBe(true);
    const { tool } = createWorkThreads({
      getController,
      storage,
      agents: [
        { id: 'site', name: 'Site builder', description: 'Builds sites.', modeId: 'site' },
        { id: 'email', name: 'Email marketer', description: 'Writes emails.', modeId: 'email' },
      ],
    });
    expect(parses(tool, { title: 'T', brief: 'B', agent: 'email' })).toBe(true);
    expect(parses(tool, { title: 'T', brief: 'B' })).toBe(true);
    expect(parses(tool, { title: 'T', brief: 'B', agent: 'x' })).toBe(false);
  });
});
