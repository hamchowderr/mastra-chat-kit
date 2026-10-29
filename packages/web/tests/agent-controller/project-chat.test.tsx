import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectChat } from '@/components/chat-project/project-chat';
import { threadIdFromHref } from '@/components/chat-project/thread-row';
import {
  chatThreads,
  offered,
  startedAfter,
  startWords,
} from '@/components/chat-project/thread-suggestions';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fakeController } from './fake-controller';

/**
 * The project skin: one chat, the threads it started as rows with their status, and a thread
 * opening into its own conversation in the panel beside the chat, where what it waits on (an
 * approval parked while nobody watched) can be answered on the thread's own Session.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const MAIN = 'main-1';
const WORK = 'work-1';

function setup() {
  return fakeController({
    threads: [
      {
        id: WORK,
        title: 'Oslo weather',
        parentThreadId: MAIN,
        status: 'needs_you',
        latest: 'Waiting for your OK to run getWeather',
        agent: { id: 'research', name: 'Researcher' },
        tasks: [
          { content: 'Look up the forecast', status: 'completed' },
          { content: 'Report back', status: 'pending' },
        ],
      },
      { id: 'work-3', title: 'Tag cleanup', parentThreadId: MAIN, status: 'done' },
      { id: 'work-2', title: 'Old report', parentThreadId: MAIN, status: 'done', resolved: true },
      { id: MAIN, title: 'Main' },
      { id: 'older', title: 'An older chat' },
    ],
    messages: {
      [MAIN]: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Check the Oslo weather' }] },
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'I started a thread for it.' },
            { type: 'data-work-thread', data: { threadId: WORK, title: 'Oslo weather' } },
          ],
        },
        {
          id: 'a2',
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: `[Oslo weather](#thread=${WORK}) needs you: it is waiting for your OK to run getWeather.`,
            },
          ],
        },
      ],
      [WORK]: [
        { id: 'w1', role: 'user', parts: [{ type: 'text', text: 'Check the weather in Oslo.' }] },
      ],
    },
    pending: {
      [WORK]: {
        running: false,
        events: [
          {
            type: 'tool_approval_required',
            toolCallId: 'gate-1',
            toolName: 'getWeather',
            args: { location: 'Oslo' },
            category: null,
          },
        ],
      },
    },
  });
}

const renderChat = (props: Parameters<typeof ProjectChat>[0] = {}) =>
  render(
    <TooltipProvider>
      <ProjectChat {...props} />
    </TooltipProvider>,
  );

/** A button in the chat, not in the panel beside it. */
const inChat = async (name: RegExp) => {
  const found = (await screen.findAllByRole('button', { name })).find(
    (b) => !b.closest('[role="tabpanel"]'),
  );
  if (!found) throw new Error(`no ${name} button in the conversation`);
  return found;
};

describe('ProjectChat', () => {
  it('opens the newest chat with a row for the thread it started', async () => {
    setup();
    renderChat();
    const row = await inChat(/Oslo weather/);
    expect(within(row).getByText('Waiting on you')).toBeInTheDocument();
    expect(screen.getByText('I started a thread for it.')).toBeInTheDocument();
  });

  it('opens a thread beside its chat and answers its approval on that thread', async () => {
    const api = setup();
    renderChat();
    fireEvent.click(await inChat(/Oslo weather/));

    expect(await screen.findByText('Check the weather in Oslo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Threads' })).toBeInTheDocument();
    // The chat stays in view beside the thread.
    expect(screen.getByText('I started a thread for it.')).toBeInTheDocument();
    expect(await inChat(/Oslo weather/)).toHaveAttribute('aria-current', 'true');
    // Each conversation has its own box, named apart, and focus moves into the thread.
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message this thread' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close thread' })).toHaveFocus();
    fireEvent.click(await screen.findByRole('button', { name: /^Approve$/ }));

    await waitFor(() => expect(api.sent('/api/agent-controller/approve')).toHaveLength(1));
    expect(api.sent('/api/agent-controller/approve')[0]?.body).toEqual({
      decision: 'approve',
      toolCallId: 'gate-1',
      threadId: WORK,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close thread' }));
    await waitFor(() => expect(screen.queryByText('Check the weather in Oslo.')).toBeNull());
    expect(screen.getByText('I started a thread for it.')).toBeInTheDocument();
  });

  it('lists threads by what they need, with their checklist and latest line', async () => {
    setup();
    renderChat();
    const list = await screen.findByRole('tabpanel', { name: /^Threads/ });
    expect(within(list).getByText('1 thread is waiting on you.')).toBeInTheDocument();
    const waiting = within(list).getByRole('region', { name: 'Waiting on you' });
    expect(within(waiting).getByText('Oslo weather')).toBeInTheDocument();
    expect(within(waiting).getByText('Waiting for your OK to run getWeather')).toBeInTheDocument();
    expect(within(waiting).getByText('1/2')).toBeInTheDocument();
    expect(within(waiting).getByText(/Researcher/)).toBeInTheDocument();
    // Resolved is folded until opened; chats are not threads.
    const resolved = within(list).getByRole('region', { name: 'Resolved' });
    expect(within(resolved).queryByText('Old report')).toBeNull();
    fireEvent.click(within(resolved).getByRole('button', { name: /Resolved/ }));
    expect(within(resolved).getByText('Old report')).toBeInTheDocument();
    expect(within(list).queryByText('An older chat')).toBeNull();
  });

  it('resolves an idle thread, keeping focus in the list', async () => {
    const api = setup();
    renderChat();
    const list = await screen.findByRole('tabpanel', { name: /^Threads/ });
    const idle = within(list).getByRole('region', { name: 'Idle' });
    fireEvent.click(within(idle).getByRole('button', { name: 'Resolve Tag cleanup' }));
    await waitFor(() =>
      expect(api.sent('/api/agent-controller/threads/work-3')[0]?.body).toEqual({
        resolved: true,
      }),
    );
    // Nothing that works or waits can be resolved.
    const waiting = within(list).getByRole('region', { name: 'Waiting on you' });
    expect(within(waiting).queryByRole('button', { name: /^Resolve/ })).toBeNull();
    await waitFor(() => expect(list.contains(document.activeElement)).toBe(true));
  });

  it('reopens a resolved thread from the list', async () => {
    const api = setup();
    renderChat();
    const list = await screen.findByRole('tabpanel', { name: /^Threads/ });
    fireEvent.click(within(list).getByRole('button', { name: /Resolved/ }));
    fireEvent.click(within(list).getByRole('button', { name: 'Reopen Old report' }));
    await waitFor(() =>
      expect(api.sent('/api/agent-controller/threads/work-2')[0]?.body).toEqual({
        resolved: false,
      }),
    );
  });

  it("shows the open thread's checklist above its conversation", async () => {
    setup();
    renderChat();
    fireEvent.click(await inChat(/Oslo weather/));
    const progress = await screen.findByRole('region', { name: 'Progress' });
    expect(within(progress).getByText('Look up the forecast')).toBeInTheDocument();
    expect(within(progress).getByText('1/2')).toBeInTheDocument();
    // The thread's header names the agent doing the work.
    const panel = screen.getByRole('region', { name: 'Thread: Oslo weather' });
    expect(within(panel).getByText('Researcher')).toBeInTheDocument();
  });

  it('links what a thread made from its row and its header', async () => {
    setup();
    renderChat({
      outputsOf: (t) =>
        t.id === WORK ? [{ kind: 'site', label: 'Open site', href: '/sites/s1' }] : [],
    });
    const list = await screen.findByRole('tabpanel', { name: /^Threads/ });
    expect(within(list).getByRole('link', { name: 'Open site: Oslo weather' })).toHaveAttribute(
      'href',
      '/sites/s1',
    );
    expect(within(list).queryAllByRole('link')).toHaveLength(1);
    // And beside the row in the chat that started it.
    const chat = screen.getByRole('region', { name: 'Chat: Main' });
    expect(within(chat).getByRole('link', { name: 'Open site: Oslo weather' })).toHaveAttribute(
      'href',
      '/sites/s1',
    );
    fireEvent.click(await inChat(/Oslo weather/));
    const panel = await screen.findByRole('region', { name: 'Thread: Oslo weather' });
    expect(within(panel).getByRole('link', { name: 'Open site' })).toHaveAttribute(
      'href',
      '/sites/s1',
    );
  });

  it('keeps one chat, with no list of chats to switch between', async () => {
    setup();
    renderChat();
    await inChat(/Oslo weather/);
    expect(screen.queryByRole('tab', { name: 'Chats' })).toBeNull();
    expect(screen.queryByRole('button', { name: /New chat/ })).toBeNull();
    expect(screen.queryByText('An older chat')).toBeNull();
  });

  it("uses the kit's full composer in the chat and in a thread", async () => {
    setup();
    renderChat();
    const chat = await screen.findByRole('region', { name: 'Chat: Main' });
    await within(chat).findByText('I started a thread for it.');
    expect(
      within(chat).getByRole('button', { name: 'Attach images or files' }),
    ).toBeInTheDocument();
    expect(within(chat).getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    // A finished reply can be copied.
    expect(within(chat).getAllByRole('button', { name: 'Copy' }).length).toBeGreaterThan(0);
    fireEvent.click(await inChat(/Oslo weather/));
    const panel = await screen.findByRole('region', { name: 'Thread: Oslo weather' });
    expect(
      within(panel).getByRole('button', { name: 'Attach images or files' }),
    ).toBeInTheDocument();
  });

  it("adds the host's items to the + menu and its fields to every turn", async () => {
    const api = setup();
    renderChat({
      composerMenu: <span>Connectors</span>,
      turnExtra: () => ({ appsOff: ['gmail'], text: 'not this' }),
    });
    const chat = await screen.findByRole('region', { name: 'Chat: Main' });
    await within(chat).findByText('I started a thread for it.');
    expect(within(chat).getByRole('button', { name: 'Add files and more' })).toBeInTheDocument();
    fireEvent.change(within(chat).getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Draft a reply' },
    });
    fireEvent.click(within(chat).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.sent('/api/agent-controller/stream')).toHaveLength(1));
    // The host's field rides along; it can't replace the kit's own.
    expect(api.sent('/api/agent-controller/stream')[0]?.body).toMatchObject({
      text: 'Draft a reply',
      appsOff: ['gmail'],
    });
  });

  it("shows the host's tabs after Threads, and hides and shows the panel", async () => {
    setup();
    renderChat({ tabs: [{ id: 'library', label: 'Library', content: <p>Brand guide.pdf</p> }] });
    fireEvent.click(await screen.findByRole('tab', { name: 'Library' }));
    expect(await screen.findByRole('tabpanel', { name: 'Library' })).toHaveTextContent(
      'Brand guide.pdf',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }));
    expect(screen.queryByRole('tab', { name: 'Library' })).toBeNull();
    // A thread waits on you, so the button to show the panel again says so.
    fireEvent.click(screen.getByRole('button', { name: 'Show threads, 1 waiting on you' }));
    expect(await screen.findByRole('tab', { name: 'Library' })).toBeInTheDocument();
  });

  it('goes back to the Threads tab when a thread opened from it closes', async () => {
    setup();
    renderChat();
    const list = await screen.findByRole('tabpanel', { name: /^Threads/ });
    const waiting = within(list).getByRole('region', { name: 'Waiting on you' });
    const row = within(waiting)
      .getAllByRole('button')
      .find((b) => /Oslo weather/.test(b.textContent ?? ''));
    if (!row) throw new Error('no row for Oslo weather');
    row.focus();
    fireEvent.click(row);
    fireEvent.click(await screen.findByRole('button', { name: 'Close thread' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Threads/ })).toHaveFocus());
  });

  it('opens the thread a link to this page names, then drops the link', async () => {
    setup();
    window.history.replaceState(null, '', `/chat#thread=${WORK}`);
    renderChat();
    expect(await screen.findByText('Check the weather in Oslo.')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/chat');
  });

  it("opens a thread from the report's link", async () => {
    setup();
    renderChat();
    fireEvent.click(await screen.findByRole('link', { name: 'Oslo weather' }));
    expect(await screen.findByText('Check the weather in Oslo.')).toBeInTheDocument();
  });
});

describe('threadIdFromHref', () => {
  it('offers suggested threads with Start buttons, and shows one already started', async () => {
    const api = fakeController({
      threads: [
        { id: WORK, title: 'Oslo weather', parentThreadId: MAIN, status: 'needs_you' },
        { id: MAIN, title: 'Main' },
      ],
      messages: {
        [MAIN]: [
          {
            id: 'a0',
            role: 'assistant',
            // An older thread of the same name as a suggestion is not the suggestion's.
            parts: [
              { type: 'data-work-thread', data: { threadId: 'old-1', title: 'Spring plan' } },
            ],
          },
          {
            id: 'a1',
            role: 'assistant',
            parts: [
              { type: 'text', text: 'Here is what we could do.' },
              {
                type: 'data-thread-suggestions',
                data: {
                  suggestions: [
                    { title: 'Spring plan', why: 'The season starts soon.' },
                    { title: 'Summer plan', why: 'Book early.' },
                    { title: 'Oslo weather', why: 'For the trip.' },
                  ],
                },
              },
            ],
          },
          {
            id: 'a2',
            role: 'assistant',
            parts: [{ type: 'data-work-thread', data: { threadId: WORK, title: 'Oslo weather' } }],
          },
        ],
      },
    });
    renderChat();
    const card = await screen.findByRole('region', { name: 'Suggested threads' });
    expect(within(card).getByText('The season starts soon.')).toBeInTheDocument();
    // Started already: its status and a way in, not Start.
    const started = within(card).getByRole('button', { name: 'Open Oslo weather' });
    expect(within(started).getByText('Waiting on you')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Start Oslo weather' })).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: 'Start 2 threads' }));
    await waitFor(() => expect(api.sent('/api/agent-controller/stream')).toHaveLength(1));
    expect(api.sent('/api/agent-controller/stream')[0]?.body).toMatchObject({
      text: 'Start the suggested threads "Spring plan", "Summer plan".',
    });
  });

  it('draws a card only for suggestions the tool accepted', () => {
    expect(offered({ suggested: ['A'] })).toBe(true);
    expect(offered({ refused: 'This turn read outside content.' })).toBe(false);
    expect(offered(undefined)).toBe(false);
    expect(startWords(['A'])).toBe('Start the suggested thread "A".');
  });

  it("takes a thread for a card's suggestion only between that card and the next to offer it", () => {
    const card = (id: string, titles: string[]) => ({
      content: [
        {
          type: 'tool_call',
          id,
          name: 'suggest_threads',
          args: { threads: titles.map((title) => ({ title, why: '' })) },
        },
        { type: 'tool_result', id, result: { suggested: titles } },
      ],
    });
    const start = (id: string, title: string) => ({
      content: [
        { type: 'tool_call', id, name: 'start_thread', args: { title } },
        { type: 'tool_result', id, result: { threadId: `t-${id}`, title } },
      ],
    });
    const made = chatThreads([
      start('s0', 'Tags'),
      card('c1', ['Tags', 'Notes']),
      card('c2', ['Tags']),
      start('s3', 'tags '),
    ]);
    expect(startedAfter(made, 1, 'Tags')).toBeUndefined();
    expect(startedAfter(made, 2, 'Tags')?.threadId).toBe('t-s3');
    expect(startedAfter(made, 1, 'Notes')).toBeUndefined();
  });

  it('reads only thread links', () => {
    expect(threadIdFromHref('#thread=a%2Fb')).toBe('a/b');
    expect(threadIdFromHref('https://example.com')).toBeNull();
    expect(threadIdFromHref(null)).toBeNull();
  });
});
