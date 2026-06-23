import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chat } from '@/components/chat/chat';
import { TooltipProvider } from '@/components/ui/tooltip';

// Verifies the chat shell mounts with the FULL PromptInput surface — not a
// stripped textarea. Catches missing/broken pieces of the rich input.
describe('Chat shell — full PromptInput surface', () => {
  it('renders textarea, web-search toggle, and empty state', () => {
    render(
      <TooltipProvider>
        <Chat />
      </TooltipProvider>,
    );
    expect(screen.getByPlaceholderText('Ask anything…')).toBeInTheDocument();
    // web-search toggle button from the toolbar
    expect(screen.getAllByText('Search').length).toBeGreaterThan(0);
    // model selector renders the default value (may appear in trigger + items)
    expect(screen.getAllByText(/Claude Sonnet/).length).toBeGreaterThan(0);
    // empty-state title
    expect(screen.getAllByText('mastra-chat-kit').length).toBeGreaterThan(0);
  });
});
