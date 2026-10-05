import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/chat-panel/chat-panel';

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
      <ChatPanel
        title="Assistant"
        greeting={{ title: 'Hi Simone', description: 'Ask about your work.' }}
        suggestions={[{ label: 'Grants closing soon', prompt: 'Which grants close this month?' }]}
        actions={<button type="button">Close</button>}
      />,
    );
    expect(screen.getByText('Assistant')).toBeInTheDocument();
    expect(screen.getByLabelText('Chat history')).toBeInTheDocument();
    expect(screen.getByLabelText('New chat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByText('Hi Simone')).toBeInTheDocument();
    expect(screen.getByText('Grants closing soon')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('How can I help you today?')).toBeInTheDocument();
  });

  it('has no model picker', () => {
    render(<ChatPanel />);
    expect(screen.queryByText(/Sonnet|Haiku|GPT/)).not.toBeInTheDocument();
  });

  it('sends a suggestion through the shared stream route', async () => {
    render(<ChatPanel suggestions={[{ label: 'Due this week', prompt: 'What is due?' }]} />);
    fireEvent.click(screen.getByText('Due this week'));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/agent-controller/stream')).toBe(true),
    );
    const stream = calls.find((c) => c.url === '/api/agent-controller/stream');
    expect(JSON.parse(stream?.body ?? '{}').text).toBe('What is due?');
  });

  it('sends on Enter but not on Shift+Enter, and only with text', async () => {
    render(<ChatPanel />);
    const box = screen.getByLabelText('Message');
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(calls.some((c) => c.url === '/api/agent-controller/stream')).toBe(false);
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/agent-controller/stream')).toBe(true),
    );
  });

  it('reads the conversation history from the shared threads route', async () => {
    render(<ChatPanel />);
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/agent-controller/threads')).toBe(true),
    );
  });
});
