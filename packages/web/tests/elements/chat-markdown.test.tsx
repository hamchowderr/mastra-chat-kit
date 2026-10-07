import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { appHref, ChatLinkProvider, ChatMarkdown } from '@/components/chat/chat-markdown';

/**
 * Links in agent replies (components/chat/chat-markdown.tsx): app links navigate in place
 * through next/link and tell the host (so a phone sheet can close); other links open in a
 * new tab; Streamdown's link-safety dialog never appears.
 */

const REPLY = 'See [the grant](/grants/42), [Mastra](https://mastra.ai/docs) and [notes](#notes).';

function renderReply(onNavigate = vi.fn()) {
  render(
    <ChatLinkProvider onNavigate={onNavigate}>
      <ChatMarkdown>{REPLY}</ChatMarkdown>
    </ChatLinkProvider>,
  );
  return onNavigate;
}

describe('ChatMarkdown links', () => {
  it('an app link is a plain in-app link, with no dialog button and no new tab', async () => {
    renderReply();
    const link = await screen.findByRole('link', { name: 'the grant' });
    expect(link).toHaveAttribute('href', '/grants/42');
    expect(link).not.toHaveAttribute('target');
    // Streamdown's link safety renders links as buttons behind a dialog: none here.
    expect(screen.queryByRole('button', { name: 'the grant' })).toBeNull();
  });

  it('following an app link tells the host, so a sheet showing the chat can close', async () => {
    const onNavigate = renderReply();
    const link = await screen.findByRole('link', { name: 'the grant' });
    // jsdom has no Next.js router; stop next/link's own navigation after our handler ran.
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('/grants/42');
  });

  it('a modified click (new tab) does not close the sheet', async () => {
    const onNavigate = renderReply();
    const link = await screen.findByRole('link', { name: 'the grant' });
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('an external link opens in a new tab directly, with noopener', async () => {
    const onNavigate = renderReply();
    const link = await screen.findByRole('link', { name: 'Mastra' });
    expect(link).toHaveAttribute('href', 'https://mastra.ai/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an anchor on the page stays a plain link', async () => {
    renderReply();
    const link = await screen.findByRole('link', { name: 'notes' });
    expect(link).toHaveAttribute('href', '#notes');
    expect(link).not.toHaveAttribute('target');
  });
});

describe('appHref', () => {
  const origin = 'https://app.example.com';
  it('keeps paths, and turns same-origin URLs into paths', () => {
    expect(appHref('/grants/42?tab=notes', origin)).toBe('/grants/42?tab=notes');
    expect(appHref('https://app.example.com/people/7#bio', origin)).toBe('/people/7#bio');
  });
  it('treats other sites and protocol-relative URLs as external', () => {
    expect(appHref('https://mastra.ai/docs', origin)).toBeNull();
    expect(appHref('//evil.example.com/x', origin)).toBeNull();
    expect(appHref('mailto:simone@example.com', origin)).toBeNull();
  });
});
