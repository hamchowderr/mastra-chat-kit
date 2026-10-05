import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/chat-panel/chat-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fakeController } from './fake-controller';

/**
 * A host learns when the agent finishes a tool call, with the tool's name (tool_end
 * carries only the call id; the name comes from tool_start), so it can, say, refresh
 * its page after a write.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('onToolEnd', () => {
  it('reports each finished tool call with its name', async () => {
    fakeController({
      stream: [
        { type: 'tool_start', toolCallId: 'c1', toolName: 'createTask', args: {} },
        { type: 'tool_end', toolCallId: 'c1', result: { ok: true } },
        { type: 'tool_start', toolCallId: 'c2', toolName: 'searchGrants', args: {} },
        { type: 'tool_end', toolCallId: 'c2', isError: true },
      ],
    });
    const onToolEnd = vi.fn();
    render(
      <TooltipProvider>
        <ChatPanel suggestions={[{ label: 'Go', prompt: 'Add a task' }]} onToolEnd={onToolEnd} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByText('Go'));
    await waitFor(() => expect(onToolEnd).toHaveBeenCalledTimes(2));
    expect(onToolEnd).toHaveBeenNthCalledWith(1, {
      toolName: 'createTask',
      toolCallId: 'c1',
      isError: false,
    });
    expect(onToolEnd).toHaveBeenNthCalledWith(2, {
      toolName: 'searchGrants',
      toolCallId: 'c2',
      isError: true,
    });
  });
});
