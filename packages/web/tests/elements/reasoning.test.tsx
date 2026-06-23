import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Reasoning, ReasoningContent } from '@/components/ai-elements/reasoning';

describe('Reasoning', () => {
  it('shows reasoning content when open', () => {
    render(
      <Reasoning isStreaming={false} defaultOpen duration={2}>
        <ReasoningContent>Considering the options.</ReasoningContent>
      </Reasoning>,
    );
    expect(screen.getByText(/Considering the options/)).toBeInTheDocument();
  });
});
