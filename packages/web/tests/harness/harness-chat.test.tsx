import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HarnessChat } from '@/components/chat/harness-chat';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useHarnessChat } from '@/lib/harness/use-harness-chat';

// The harness hook is lifted to the shell now, so feed HarnessChat a real session
// via a tiny host (the hook does no network on mount).
function HarnessChatHost() {
  const harness = useHarnessChat();
  return <HarnessChat harness={harness} />;
}

// The Agent Harness view mounts with the SHARED composer (full PromptInput) and
// the empty state — no network on mount. Proves the harness transport wiring
// renders without the live server.
describe('HarnessChat — Agent Harness view', () => {
  it('mounts with the shared composer and empty state', () => {
    render(
      <TooltipProvider>
        <HarnessChatHost />
      </TooltipProvider>,
    );
    expect(screen.getByPlaceholderText('Ask anything…')).toBeInTheDocument();
    expect(screen.getAllByText('Search').length).toBeGreaterThan(0);
    // Harness empty-state hero (distinct from the Single Agent view's title).
    expect(screen.getByText(/on your mind today/)).toBeInTheDocument();
  });
});
