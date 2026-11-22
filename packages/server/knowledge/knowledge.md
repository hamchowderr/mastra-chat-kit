---
description: How the chat kit's knowledge base is filled, searched and kept in sync.
---
# Knowledge

The chat agent's knowledge base is Mastra Knowledge: markdown pages stored in libSQL next
to memory, in the `org:chat-kit` scope.

- **Search and read**: the agent calls `knowledge_search`, then `knowledge_read` for the
  full page, and cites the page it used. Search blends keyword and semantic matches.
- **Write**: asked to remember a fact, the agent adds a note with `knowledge_note` or a
  page with `knowledge_page`. Notes and edits ask for approval first.
- **Sync**: at boot the server mirrors the `KNOWLEDGE_DIR` folder into the scope. New files
  become pages, edited files update them, and deleted files have their pages removed.
- **Browse**: Studio's Knowledge page shows the tree, the graph and search.

The research specialist gets the read tools only.
