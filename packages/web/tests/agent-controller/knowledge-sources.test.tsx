import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KnowledgeSources, knowledgeSearchSources } from '@/components/chat/tool-views';

// A knowledge_search result as Mastra Knowledge returns it (@mastra/core/knowledge).
const output = {
  results: [
    {
      type: 'page',
      page: {
        id: 'p1',
        name: 'Mastra memory',
        ref: 'org:chat-kit#memory',
        scope: 'org:chat-kit',
        description: 'Threads, working memory and semantic recall.',
      },
    },
    {
      type: 'note',
      page: { id: 'p1', name: 'Mastra memory', ref: 'org:chat-kit#memory', scope: 'org:chat-kit' },
      note: { id: 'n1', text: 'Recall uses fastembed locally.', author: 'agent' },
    },
    {
      type: 'page',
      page: { id: 'p2', name: 'Knowledge', ref: 'org:chat-kit#knowledge', scope: 'org:chat-kit' },
    },
  ],
};

describe('knowledge_search → sources', () => {
  it('maps hits to one source per page, preferring a note as the snippet', () => {
    expect(knowledgeSearchSources(output)).toEqual([
      {
        title: 'Mastra memory',
        ref: 'org:chat-kit#memory',
        snippet: 'Recall uses fastembed locally.',
      },
      { title: 'Knowledge', ref: 'org:chat-kit#knowledge' },
    ]);
  });

  it('returns undefined for output that is not a search result, and [] for no hits', () => {
    expect(knowledgeSearchSources(undefined)).toBeUndefined();
    expect(knowledgeSearchSources({ error: 'nope' })).toBeUndefined();
    expect(knowledgeSearchSources({ results: [], more: ['results: none'] })).toEqual([]);
  });

  it('renders a Knowledge page (no URL) as a named source and citation', () => {
    render(<KnowledgeSources results={knowledgeSearchSources(output) ?? []} />);
    expect(screen.getByText('Used 2 sources')).toBeInTheDocument();
    // The citation badge carries the page name, where a web source shows its hostname.
    expect(screen.getAllByText('Mastra memory').length).toBeGreaterThan(0);
    expect(screen.getByText('[1]')).toBeInTheDocument();
    expect(screen.getByText('[2]')).toBeInTheDocument();
  });

  it('still renders a web source by its hostname', () => {
    render(<KnowledgeSources results={[{ title: 'Docs', url: 'https://mastra.ai/docs' }]} />);
    expect(screen.getByText(/mastra\.ai/)).toBeInTheDocument();
  });
});
