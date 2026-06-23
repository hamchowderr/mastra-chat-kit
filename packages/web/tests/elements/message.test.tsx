import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Message, MessageContent } from '@/components/ai-elements/message';

describe('Message', () => {
  it('renders user message content', () => {
    render(
      <Message from="user">
        <MessageContent>Hello there</MessageContent>
      </Message>,
    );
    expect(screen.getByText('Hello there')).toBeInTheDocument();
  });

  it('renders assistant message content', () => {
    render(
      <Message from="assistant">
        <MessageContent>How can I help?</MessageContent>
      </Message>,
    );
    expect(screen.getByText('How can I help?')).toBeInTheDocument();
  });
});
