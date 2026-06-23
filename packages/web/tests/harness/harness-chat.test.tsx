import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HarnessChat } from '@/components/chat/harness-chat';
import { TooltipProvider } from '@/components/ui/tooltip';

// The Agent Harness view mounts with the SHARED composer (full PromptInput) and
// the empty state — no network on mount. Proves the harness transport wiring
// renders without the live server.
describe('HarnessChat — Agent Harness view', () => {
  it('mounts with the shared composer and empty state', () => {
    render(
      <TooltipProvider>
        <HarnessChat />
      </TooltipProvider>,
    );
    expect(screen.getByPlaceholderText('Ask anything…')).toBeInTheDocument();
    expect(screen.getAllByText('Search').length).toBeGreaterThan(0);
    expect(screen.getAllByText('mastra-chat-kit').length).toBeGreaterThan(0);
  });
});
