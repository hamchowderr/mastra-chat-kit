import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Suggestion } from '@/components/ai-elements/suggestion';

describe('Suggestion', () => {
  it('renders the suggestion and fires onClick with its text', () => {
    const onClick = vi.fn();
    render(<Suggestion suggestion="Summarize this" onClick={onClick} />);
    fireEvent.click(screen.getByText('Summarize this'));
    expect(onClick).toHaveBeenCalledWith('Summarize this');
  });
});
