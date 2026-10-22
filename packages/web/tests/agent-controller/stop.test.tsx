import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectChat } from '@/components/chat-project/project-chat';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Stop: while an answer streams, the send button becomes Stop, and pressing it closes the
 * stream, which is what aborts the run on the server.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A /stream that sends one event and then stays open until the request is aborted. */
function endlessStream() {
  let aborted = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (String(input) !== '/api/agent-controller/stream') {
        return Response.json(String(input).endsWith('/threads') ? { threads: [] } : {});
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify({ type: 'agent_start' })}\n\n`),
          );
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            controller.error(new DOMException('The operation was aborted.', 'AbortError'));
          });
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }),
  );
  return { aborted: () => aborted };
}

describe('Stop', () => {
  it('stops the answer streaming now, without an error', async () => {
    const api = endlessStream();
    render(
      <TooltipProvider>
        <ProjectChat />
      </TooltipProvider>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Clean up my contacts' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));

    expect(api.aborted()).toBe(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.queryByText(/aborted/i)).toBeNull();
  });
});
