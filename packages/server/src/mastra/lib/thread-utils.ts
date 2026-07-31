/**
 * Helpers for the chat-history sidebar thread routes. Mastra message content is
 * heterogeneous (string | { parts } | array), so these normalize it for display.
 */

// biome-ignore lint/suspicious/noExplicitAny: Mastra message content is heterogeneous
export function messageText(m: any): string {
  const content = m?.content;
  if (typeof content === 'string') {
    return content;
  }
  // biome-ignore lint/suspicious/noExplicitAny: part union
  const parts: any[] | undefined = Array.isArray(content?.parts)
    ? content.parts
    : Array.isArray(content)
      ? content
      : undefined;
  if (parts) {
    return parts
      .map((p) => {
        // Assistant text arrives as a text part; the user's own turn (Mastra core
        // ≥1.52 "format 2") arrives as a data-user-message part with the text on
        // data.contents.
        if (p?.type === 'text' && typeof p.text === 'string') return p.text;
        if (p?.type === 'data-user-message' && typeof p?.data?.contents === 'string') {
          return p.data.contents;
        }
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  if (typeof content?.text === 'string') {
    return content.text;
  }
  return '';
}

/** Thread display title: explicit title → first user message snippet → "New chat". */
// biome-ignore lint/suspicious/noExplicitAny: StorageThreadType
export function threadTitle(thread: any, firstUserMessage?: string): string {
  const title = typeof thread?.title === 'string' ? thread.title.trim() : '';
  if (title) {
    return title;
  }
  const fm = (firstUserMessage ?? '').trim();
  if (fm) {
    return fm.split(/\s+/).slice(0, 8).join(' ');
  }
  return 'New chat';
}

/** A text-only UIMessage (AI SDK v7 parts shape) for restoring a thread into the chat UI. */
// biome-ignore lint/suspicious/noExplicitAny: MastraDBMessage
export function toUIMessage(m: any): {
  id: string;
  role: 'user' | 'assistant';
  parts: { type: 'text'; text: string }[];
} {
  return {
    id: String(m?.id ?? `${m?.threadId ?? 't'}-${m?.createdAt ?? Math.random()}`),
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    parts: [{ type: 'text', text: messageText(m) }],
  };
}

/** A short, query-centered excerpt for search results. */
export function searchSnippet(text: string, query: string): string {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) {
    return text.slice(0, 100);
  }
  const start = Math.max(0, i - 40);
  const end = Math.min(text.length, i + query.length + 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
