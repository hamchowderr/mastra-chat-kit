import { RequestContext } from '@mastra/core/request-context';
import { describe, expect, it, vi } from 'vitest';
import { chatAgent } from '../../src/mastra/agents/chat';
import { createControllerRoutes } from '../../src/mastra/routes/controller';
import type { ChatServerDeps } from '../../src/mastra/routes/types';
import { ctx, deps, find } from '../helpers/route-harness';

/**
 * POST /agent-controller/stream, driven with a fake Session: what the route does
 * with the composer's model pick and Search toggle, what it adds to the events it
 * forwards, and that a closed tab stops the run. No model, no network.
 */

// biome-ignore lint/suspicious/noExplicitAny: fake Session events are loose by design
type AnyEvent = any;

function fakeSession(sendMessage: (args: AnyEvent) => Promise<void> = async () => {}) {
  let listener: ((e: AnyEvent) => void) | null = null;
  const unsubscribe = vi.fn();
  return {
    thread: {
      create: vi.fn(async () => {}),
      switch: vi.fn(async () => {}),
      requireId: () => 'thread-1',
    },
    model: { switch: vi.fn(async () => {}) },
    subscribe: vi.fn((fn: (e: AnyEvent) => void) => {
      listener = fn;
      return unsubscribe;
    }),
    sendMessage: vi.fn(sendMessage),
    abort: vi.fn(),
    unsubscribe,
    emit: (e: AnyEvent) => listener?.(e),
  };
}

type FakeSession = ReturnType<typeof fakeSession>;

function streamRoute(session: FakeSession, over: Partial<ChatServerDeps> = {}) {
  const controller = {
    getToolCategory: ({ toolName }: { toolName: string }) =>
      toolName === 'getWeather' ? 'read' : null,
  };
  return find(
    createControllerRoutes(
      deps({
        getSession: () =>
          Promise.resolve(session as unknown as Awaited<ReturnType<ChatServerDeps['getSession']>>),
        getAgentController: () =>
          Promise.resolve(
            controller as unknown as Awaited<ReturnType<ChatServerDeps['getAgentController']>>,
          ),
        modelAllowlist: new Set(['openai/gpt-4.1-mini']),
        ...over,
      }),
    ),
    '/agent-controller/stream',
    'POST',
  );
}

/** Run the route and return every SSE event it wrote. */
async function run(session: FakeSession, body: Record<string, unknown>, signal?: AbortSignal) {
  const { c } = ctx({ body, signal });
  const res = (await streamRoute(session).handler(c)) as Response;
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)));
}

describe('/agent-controller/stream', () => {
  it('switches to an allowlisted model, and ignores one that is not', async () => {
    const allowed = fakeSession();
    await run(allowed, { text: 'hi', model: 'openai/gpt-4.1-mini' });
    expect(allowed.model.switch).toHaveBeenCalledWith({ modelId: 'openai/gpt-4.1-mini' });

    const blocked = fakeSession();
    await run(blocked, { text: 'hi', model: 'someone/expensive-model' });
    expect(blocked.model.switch).not.toHaveBeenCalled();
  });

  it('passes the Search toggle as webSearch on the request context, only when on', async () => {
    const on = fakeSession();
    await run(on, { text: 'hi', webSearch: true });
    const ctxOn = on.sendMessage.mock.calls[0]?.[0]?.requestContext as RequestContext;
    expect(ctxOn.get('webSearch')).toBe(true);

    const off = fakeSession();
    await run(off, { text: 'hi' });
    expect(off.sendMessage.mock.calls[0]?.[0]?.requestContext).toBeUndefined();
  });

  it("maps the composer's attachments onto sendMessage files, and sends none without them", async () => {
    const withFiles = fakeSession();
    const url = 'data:text/plain;base64,aGVsbG8=';
    await run(withFiles, {
      text: 'read this',
      files: [
        { url, mediaType: 'text/plain', filename: 'hello.txt' },
        { url, mediaType: 'text/plain' },
      ],
    });
    expect(withFiles.sendMessage.mock.calls[0]?.[0]?.files).toEqual([
      { data: url, mediaType: 'text/plain', filename: 'hello.txt' },
      { data: url, mediaType: 'text/plain' },
    ]);

    const without = fakeSession();
    await run(without, { text: 'hi' });
    expect(without.sendMessage.mock.calls[0]?.[0]?.files).toBeUndefined();
  });

  it('adds the tool category to tool_approval_required, null when uncategorized', async () => {
    const session = fakeSession(async () => {
      session.emit({
        type: 'tool_approval_required',
        toolCallId: 'a',
        toolName: 'getWeather',
        args: {},
      });
      session.emit({
        type: 'tool_approval_required',
        toolCallId: 'b',
        toolName: 'mystery',
        args: {},
      });
    });
    const events = await run(session, { text: 'hi' });
    const gates = events.filter((e) => e.type === 'tool_approval_required');
    expect(gates.map((e) => e.category)).toEqual(['read', null]);
  });

  it('aborts the run and stops forwarding when the client disconnects', async () => {
    let finish: () => void = () => {};
    const session = fakeSession(() => new Promise<void>((resolve) => (finish = resolve)));
    const tab = new AbortController();

    // Don't read the body: after a disconnect the route deliberately leaves the
    // stream unclosed (nobody is reading it), so reading to the end would hang.
    const { c } = ctx({ body: { text: 'hi' }, signal: tab.signal });
    await streamRoute(session).handler(c);
    await vi.waitFor(() => expect(session.sendMessage).toHaveBeenCalled());
    tab.abort();

    expect(session.abort).toHaveBeenCalled();
    expect(session.unsubscribe).toHaveBeenCalled();
    finish();
  });
});

// mastra-chat-kit-ymk. On core 1.52 a suspending tool (ask_user) ENDS the run, so the
// /stream SSE has closed by the time the user answers. The resumed run's events must
// come back on the /answer response itself, or the answer lands and nothing renders.
describe('/agent-controller/answer', () => {
  function answerRoute(session: AnyEvent) {
    return find(
      createControllerRoutes(
        deps({
          getSession: () =>
            Promise.resolve(
              session as unknown as Awaited<ReturnType<ChatServerDeps['getSession']>>,
            ),
        }),
      ),
      '/agent-controller/answer',
      'POST',
    );
  }

  it('streams the resumed run back as SSE, then __done__', async () => {
    const session = fakeSession();
    const respondToToolSuspension = vi.fn(async () => {
      session.emit({ type: 'tool_end', toolCallId: 's1', result: 'production' });
      session.emit({ type: 'agent_end', reason: 'complete' });
    });
    const withResume = { ...session, respondToToolSuspension };

    const { c } = ctx({ body: { answer: 'production', toolCallId: 's1' } });
    const res = (await answerRoute(withResume).handler(c)) as Response;
    const events = (await res.text())
      .split('\n\n')
      .filter((chunk) => chunk.startsWith('data: '))
      .map((chunk) => JSON.parse(chunk.slice('data: '.length)));

    expect(respondToToolSuspension).toHaveBeenCalledWith({
      resumeData: 'production',
      toolCallId: 's1',
    });
    expect(events.map((e) => e.type)).toEqual(['tool_end', 'agent_end', '__done__']);
    expect(session.unsubscribe).toHaveBeenCalled();
  });
});

describe('chatAgent instructions follow the Search toggle', () => {
  it('adds the web-search instructions only when webSearch is on', async () => {
    const on = new RequestContext();
    on.set('webSearch', true);
    const withSearch = String(await chatAgent.getInstructions({ requestContext: on }));
    const without = String(
      await chatAgent.getInstructions({ requestContext: new RequestContext() }),
    );

    expect(withSearch.startsWith(without)).toBe(true);
    expect(withSearch.length).toBeGreaterThan(without.length);
  });
});
