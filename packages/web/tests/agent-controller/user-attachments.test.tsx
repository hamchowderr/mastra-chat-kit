import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatPanel } from '@/components/chat-panel/chat-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { emptyTranscript, uiMessagesToAgentController } from '@/lib/agent-controller/events';
import { reduceAgentControllerEvent } from '@/lib/agent-controller/reduce';
import { fakeController } from './fake-controller';

/**
 * A message sent with an attachment shows the user's text and the file. The controller
 * echoes such a turn with its contents as a list (text, then files) instead of a
 * string; and a stored thread keeps the files as `file` parts.
 */

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

// The user's turn exactly as the AgentController streams it when files are attached.
const userTurn = {
  type: 'message_start',
  message: {
    id: 'u1',
    role: 'signal',
    content: {
      format: 2,
      parts: [
        {
          type: 'data-user-message',
          data: {
            id: 'u1',
            type: 'user',
            contents: [
              { type: 'text', text: 'What is in this picture?' },
              { type: 'file', data: PNG, mediaType: 'image/png', filename: 'red.png' },
            ],
          },
        },
      ],
    },
  },
};

describe('user attachments', () => {
  it('keeps the text and the file of a turn sent with an attachment', () => {
    const s = reduceAgentControllerEvent(emptyTranscript(), userTurn);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('user');
    expect(s.messages[0].content).toEqual([
      { type: 'text', text: 'What is in this picture?' },
      { type: 'file', data: PNG, mediaType: 'image/png', filename: 'red.png' },
    ]);
  });

  it('turns a bare base64 file into a data URL', () => {
    const turn = structuredClone(userTurn);
    turn.message.content.parts[0].data.contents[1] = {
      type: 'file',
      data: 'iVBORw0KGgo=',
      mediaType: 'image/png',
    } as never;
    const s = reduceAgentControllerEvent(emptyTranscript(), turn);
    expect(s.messages[0].content[1]).toMatchObject({ data: PNG });
  });

  it('keeps files when a stored thread is opened', () => {
    const [m] = uiMessagesToAgentController([
      {
        id: 'u1',
        role: 'user',
        parts: [
          { type: 'text', text: 'Look' },
          { type: 'file', url: PNG, mediaType: 'image/png', filename: 'red.png' },
          { type: 'file', url: 'https://example.com/x.png', mediaType: 'image/png' },
        ],
      },
    ]);
    expect(m.content).toEqual([
      { type: 'text', text: 'Look' },
      { type: 'file', data: PNG, mediaType: 'image/png', filename: 'red.png' },
    ]);
  });

  it('shows the text and the image in the panel', async () => {
    fakeController({ stream: [userTurn] });
    render(
      <TooltipProvider>
        <ChatPanel suggestions={[{ label: 'Go', prompt: 'What is in this picture?' }]} />
      </TooltipProvider>,
    );
    screen.getByText('Go').click();
    await waitFor(() => expect(screen.getByAltText('red.png')).toBeInTheDocument());
    expect(screen.getByText('What is in this picture?')).toBeInTheDocument();
  });
});
