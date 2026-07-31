import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AskUserPrompt } from '@/components/chat/tool-views';

// The ask_user prompt renders the agent's clarifying question in three shapes
// (free-text, single-select, multi-select) and resumes the run with the answer.
describe('AskUserPrompt — ask_user suspension element', () => {
  it('free-text: renders the question and sends the typed answer', () => {
    const onAnswer = vi.fn();
    render(
      <AskUserPrompt
        suspension={{ toolCallId: 's1', toolName: 'ask_user', question: 'What should I name it?' }}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByText('What should I name it?')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Type your answer…'), {
      target: { value: 'hello.txt' },
    });
    fireEvent.click(screen.getByText('Send'));
    expect(onAnswer).toHaveBeenCalledWith('hello.txt', 's1');
  });

  it('free-text: Enter submits, empty input does not', () => {
    const onAnswer = vi.fn();
    render(
      <AskUserPrompt
        suspension={{ toolCallId: 's1', toolName: 'ask_user', question: 'Name?' }}
        onAnswer={onAnswer}
      />,
    );
    const box = screen.getByPlaceholderText('Type your answer…');
    // empty → no send
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onAnswer).not.toHaveBeenCalled();
    // typed → Enter sends
    fireEvent.change(box, { target: { value: 'foo.js' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onAnswer).toHaveBeenCalledWith('foo.js', 's1');
  });

  it('single-select: clicking a choice answers immediately with its label', () => {
    const onAnswer = vi.fn();
    render(
      <AskUserPrompt
        suspension={{
          toolCallId: 's2',
          toolName: 'ask_user',
          question: 'Which environment?',
          options: [{ label: 'staging' }, { label: 'production' }],
          selectionMode: 'single_select',
        }}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getByText('production'));
    expect(onAnswer).toHaveBeenCalledWith('production', 's2');
  });

  it('multi-select: toggles choices and sends the selected labels as an array', () => {
    const onAnswer = vi.fn();
    render(
      <AskUserPrompt
        suspension={{
          toolCallId: 's3',
          toolName: 'ask_user',
          question: 'Which features?',
          options: [{ label: 'auth' }, { label: 'billing' }, { label: 'search' }],
          selectionMode: 'multi_select',
        }}
        onAnswer={onAnswer}
      />,
    );
    // Send is disabled until something is picked.
    const send = screen.getByRole('button', { name: /^Send/ });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByText('auth'));
    fireEvent.click(screen.getByText('search'));
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    expect(onAnswer).toHaveBeenCalledWith(['auth', 'search'], 's3');
  });
});
