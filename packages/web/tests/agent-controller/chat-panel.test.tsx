import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/chat-panel/chat-panel';
import { TooltipProvider } from '@/components/ui/tooltip';

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
