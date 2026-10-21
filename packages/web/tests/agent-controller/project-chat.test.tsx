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
      { id: WORK, title: 'Oslo weather', parentThreadId: MAIN, status: 'needs_you' },
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
    expect(within(row).getByText('Needs you')).toBeInTheDocument();
    expect(screen.getByText('I started a thread for it.')).toBeInTheDocument();
  });

  it('opens a thread and answers its approval on that thread', async () => {
    const api = setup();
    renderChat();
    fireEvent.click(await inChat(/Oslo weather/));

    expect(await screen.findByText('Check the weather in Oslo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to Main/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /^Approve$/ }));

    await waitFor(() => expect(api.sent('/api/agent-controller/approve')).toHaveLength(1));
    expect(api.sent('/api/agent-controller/approve')[0]?.body).toEqual({
      decision: 'approve',
      toolCallId: 'gate-1',
      threadId: WORK,
    });

    fireEvent.click(screen.getByRole('button', { name: /Back to Main/ }));
    expect(await screen.findByText('I started a thread for it.')).toBeInTheDocument();
  });

  it("lists the chats, with each one's threads under it", async () => {
    setup();
    renderChat();
    const list = await screen.findByRole('navigation', { name: 'Chats' });
    expect(await within(list).findByRole('button', { name: /^Main$/ })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /^An older chat$/ })).toBeInTheDocument();
    // A work thread is listed under its chat, not as a chat of its own.
    expect(within(list).getByRole('button', { name: /Oslo weather/ })).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /Actions for Oslo weather/ })).toBeNull();
  });

  it('opens another chat from the list, and starts a new one', async () => {
    setup();
    renderChat();
    const list = await screen.findByRole('navigation', { name: 'Chats' });
    fireEvent.click(await within(list).findByRole('button', { name: /^An older chat$/ }));
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
