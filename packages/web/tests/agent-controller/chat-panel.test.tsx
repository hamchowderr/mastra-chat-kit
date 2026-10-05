import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/chat-panel/chat-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fakeController } from './fake-controller';

/**
 * The side-panel skin: its header (title, history, new chat, host actions), the empty
 * state (greeting + suggestions), and the composer card. It runs on the same engine as
 * the other skins, so these check the shape and that it talks to the same routes.
 */

let calls: { url: string; body?: string }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? String(init.body) : undefined });
      if (url.startsWith('/api/agent-controller/threads')) {
        return Response.json({
          threads: [
            {
              id: 't1',
              title: 'Grants closing soon',
              archived: false,
              createdAt: '2026-10-04T00:00:00Z',
              updatedAt: '2026-10-04T00:00:00Z',
            },
          ],
        });
      }
      if (url === '/api/agent-controller/stream') {
        return new Response('data: {"type":"__done__"}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return Response.json({});
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatPanel', () => {
  it('shows the header, the greeting, the suggestions and the composer', () => {
    render(
      <TooltipProvider>
        <ChatPanel
          title="Assistant"
          greeting={{ title: 'Hi Simone', description: 'Ask about your work.' }}
          suggestions={[{ label: 'Grants closing soon', prompt: 'Which grants close this month?' }]}
          actions={<button type="button">Close</button>}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText('Assistant')).toBeInTheDocument();
    expect(screen.getByLabelText('Chat history')).toBeInTheDocument();
    expect(screen.getByLabelText('New chat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByText('Hi Simone')).toBeInTheDocument();
    expect(screen.getByText('Grants closing soon')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('How can I help you today?')).toBeInTheDocument();
  });

  it('uses the shared composer: attachments, the send button, no model picker', () => {
    render(
      <TooltipProvider>
        <ChatPanel />
      </TooltipProvider>,
    );
    expect(screen.queryByText(/Sonnet|Haiku|GPT/)).not.toBeInTheDocument();
    expect(screen.queryByText('Search')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Upload files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('sends a suggestion through the shared stream route', async () => {
    render(
      <TooltipProvider>
        <ChatPanel suggestions={[{ label: 'Due this week', prompt: 'What is due?' }]} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByText('Due this week'));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/agent-controller/stream')).toBe(true),
    );
    const stream = calls.find((c) => c.url === '/api/agent-controller/stream');
    expect(JSON.parse(stream?.body ?? '{}').text).toBe('What is due?');
  });

  it('reads the conversation history from the shared threads route', async () => {
    render(
      <TooltipProvider>
        <ChatPanel />
      </TooltipProvider>,
    );
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/agent-controller/threads')).toBe(true),
    );
  });
});

describe('ChatPanel — the parts that keep a run moving', () => {
  const renderPanel = () =>
    render(
      <TooltipProvider>
        <ChatPanel suggestions={[{ label: 'Weather', prompt: 'Weather in Paris?' }]} />
      </TooltipProvider>,
    );

  it('shows the approval card for a gated tool and sends the decision', async () => {
    const api = fakeController({
      stream: [
        {
          type: 'message_end',
          message: {
            id: 'u1',
            role: 'user',
            content: [{ type: 'text', text: 'Weather in Paris?' }],
          },
        },
        {
          type: 'tool_approval_required',
          toolCallId: 'c1',
          toolName: 'getWeather',
          args: { location: 'Paris' },
          category: 'read',
        },
      ],
    });
    renderPanel();
    fireEvent.click(screen.getByText('Weather'));
    expect(await screen.findByText('Run getWeather?')).toBeInTheDocument();
    expect(screen.getByText('Always allow read tools')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.sent('/api/agent-controller/approve')).toHaveLength(1));
    expect(api.sent('/api/agent-controller/approve')[0].body).toEqual({ decision: 'approve' });
  });

  it('never hides a parked approval behind the greeting', async () => {
    fakeController({
      stream: [
        { type: 'tool_approval_required', toolCallId: 'c1', toolName: 'getWeather', args: {} },
      ],
    });
    renderPanel();
    fireEvent.click(screen.getByText('Weather'));
    expect(await screen.findByText('Run getWeather?')).toBeInTheDocument();
  });

  it("shows the agent's ask_user question and answers it", async () => {
    const api = fakeController({
      stream: [
        {
          type: 'message_end',
          message: {
            id: 'u1',
            role: 'user',
            content: [{ type: 'text', text: 'Weather in Paris?' }],
          },
        },
        {
          type: 'tool_suspended',
          toolCallId: 'q1',
          toolName: 'ask_user',
          suspendPayload: {
            question: 'Which city?',
            options: [{ label: 'Paris' }, { label: 'Lyon' }],
            selectionMode: 'single_select',
          },
        },
      ],
    });
    renderPanel();
    fireEvent.click(screen.getByText('Weather'));
    expect(await screen.findByText('Which city?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Lyon'));
    await waitFor(() => expect(api.sent('/api/agent-controller/answer')).toHaveLength(1));
    expect(api.sent('/api/agent-controller/answer')[0].body).toEqual({
      answer: 'Lyon',
      toolCallId: 'q1',
    });
  });

  it('shows a failed turn as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/agent-controller/stream'
          ? new Response('nope', { status: 502 })
          : Response.json({ threads: [] }),
      ),
    );
    renderPanel();
    fireEvent.click(screen.getByText('Weather'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'AgentController error: controller stream failed: 502',
    );
  });
});

describe('ChatPanel — History and New chat', () => {
  /** Radix menus open on a primary-button pointerdown. */
  const openHistory = () =>
    fireEvent.pointerDown(screen.getByLabelText('Chat history'), { button: 0, ctrlKey: false });

  const renderPanel = () =>
    render(
      <TooltipProvider>
        <ChatPanel greeting={{ title: 'Hi there' }} />
      </TooltipProvider>,
    );

  it('lists recent chats, opens one, and New chat starts over', async () => {
    const api = fakeController({
      threads: [
        { id: 't1', title: 'Grants closing soon' },
        { id: 't2', title: 'Old idea', archived: true },
      ],
      messages: {
        t1: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Which grants close?' }] }],
      },
    });
    renderPanel();
    await waitFor(() => expect(api.sent('/api/agent-controller/threads')).not.toHaveLength(0));
    openHistory();
    const item = await screen.findByRole('menuitem', { name: 'Grants closing soon' });
    // Archived chats stay out of the menu.
    expect(screen.queryByText('Old idea')).not.toBeInTheDocument();
    fireEvent.click(item);

    expect(await screen.findByText('Which grants close?')).toBeInTheDocument();
    expect(api.sent('/api/agent-controller/threads/t1/messages')).toHaveLength(1);
    expect(screen.queryByText('Hi there')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('New chat'));
    expect(await screen.findByText('Hi there')).toBeInTheDocument();
    expect(screen.queryByText('Which grants close?')).not.toBeInTheDocument();
  });

  it.each([
    ['there are no chats', []],
    ['every chat is archived', [{ id: 't2', title: 'Old idea', archived: true }]],
  ])('says "No chats yet." when %s', async (_label, threads) => {
    const api = fakeController({ threads });
    renderPanel();
    await waitFor(() => expect(api.sent('/api/agent-controller/threads')).not.toHaveLength(0));
    openHistory();
    expect(await screen.findByText('No chats yet.')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
});
