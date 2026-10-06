import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/chat-panel/chat-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { browserTimeZone } from '@/lib/agent-controller/use-agent-controller-chat';
import { fakeController } from './fake-controller';

/**
 * Each turn carries the browser's IANA time zone, so the agent can tell today's date
 * where the user is (server: lib/turn-context.ts).
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderPanel = () =>
  render(
    <TooltipProvider>
      <ChatPanel suggestions={[{ label: 'Go', prompt: 'Add a task for Friday' }]} />
    </TooltipProvider>,
  );

describe('time zone on each turn', () => {
  it("sends the browser's zone with the message", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/Los_Angeles',
    } as Intl.ResolvedDateTimeFormatOptions);
    const api = fakeController();
    renderPanel();
    fireEvent.click(screen.getByText('Go'));
    await waitFor(() => expect(api.sent('/api/agent-controller/stream')).toHaveLength(1));
    expect(api.sent('/api/agent-controller/stream')[0].body).toMatchObject({
      text: 'Add a task for Friday',
      timeZone: 'America/Los_Angeles',
    });
  });

  it('sends none when the runtime cannot say', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
      throw new Error('no Intl');
    });
    expect(browserTimeZone()).toBeUndefined();
  });
});
