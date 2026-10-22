import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectChat } from '@/components/chat-project/project-chat';
import { threadIdFromHref } from '@/components/chat-project/thread-row';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fakeController } from './fake-controller';

/**
 * The project skin: one main chat, the threads it started as rows with their status, and
 * a thread opening into its own conversation, where what it waits on (an approval parked
 * while nobody watched) can be answered on the thread's own Session.
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
        tasks: [
          { content: 'Look up the forecast', status: 'completed' },
          { content: 'Report back', status: 'pending' },
        ],
      },
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

const renderChat = () =>
  render(
    <TooltipProvider>
      <ProjectChat />
    </TooltipProvider>,
  );

/** A button in the conversation, not in the list of chats beside it. */
const inChat = async (name: RegExp) => {
  const found = (await screen.findAllByRole('button', { name })).find((b) => !b.closest('nav'));
  if (!found) throw new Error(`no ${name} button in the conversation`);
  return found;
};

describe('ProjectChat', () => {
  it('opens the newest main chat with a row for the thread it started', async () => {
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
    expect(screen.getByRole('button', { name: /Back to Main/ })).toBeInTheDocument();
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
    const list = await screen.findByRole('tabpanel', { name: 'Threads' });
    expect(within(list).getByText('1 thread is waiting on you.')).toBeInTheDocument();
    const waiting = within(list).getByRole('region', { name: 'Waiting on you' });
    expect(within(waiting).getByText('Oslo weather')).toBeInTheDocument();
    expect(within(waiting).getByText('Waiting for your OK to run getWeather')).toBeInTheDocument();
    expect(within(waiting).getByText('1/2')).toBeInTheDocument();
    // Resolved is folded until opened; chats are not threads.
    const resolved = within(list).getByRole('region', { name: 'Resolved' });
    expect(within(resolved).queryByText('Old report')).toBeNull();
    fireEvent.click(within(resolved).getByRole('button', { name: /Resolved/ }));
    expect(within(resolved).getByText('Old report')).toBeInTheDocument();
    expect(within(list).queryByText('An older chat')).toBeNull();
  });

  it('reopens a resolved thread from the list', async () => {
    const api = setup();
    renderChat();
    const list = await screen.findByRole('tabpanel', { name: 'Threads' });
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
  });

  it('opens another chat from the Chats tab, and starts a new one', async () => {
    setup();
    renderChat();
    fireEvent.click(await screen.findByRole('tab', { name: 'Chats' }));
    const list = await screen.findByRole('tabpanel', { name: 'Chats' });
    expect(within(list).getByRole('button', { name: /^Main$/ })).toBeInTheDocument();
    // A work thread is not a chat of its own.
    expect(within(list).queryByRole('button', { name: /Oslo weather/ })).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: /^An older chat$/ }));
    await waitFor(() => expect(screen.queryByText('I started a thread for it.')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /New chat/ }));
    expect(await screen.findByText(/Ask for anything/)).toBeInTheDocument();
  });

  it("opens a thread from the report's link", async () => {
    setup();
    renderChat();
    fireEvent.click(await screen.findByRole('link', { name: 'Oslo weather' }));
    expect(await screen.findByText('Check the weather in Oslo.')).toBeInTheDocument();
  });
});

describe('threadIdFromHref', () => {
  it('reads only thread links', () => {
    expect(threadIdFromHref('#thread=a%2Fb')).toBe('a/b');
    expect(threadIdFromHref('https://example.com')).toBeNull();
    expect(threadIdFromHref(null)).toBeNull();
  });
});
