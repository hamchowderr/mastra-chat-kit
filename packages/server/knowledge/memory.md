---
description: Threads, working memory, semantic recall and observational memory in the chat kit.
---
# Mastra memory

Every agent in the kit shares one memory policy (`createDefaultMemory`):

- **Threads**: message history per conversation, stored in libSQL. Each new thread gets
  an auto-generated title for the history sidebar.
- **Working memory**: a Markdown scratchpad per user (resource scope) with their profile
  and session state, kept across all of their threads.
- **Semantic recall**: messages are embedded locally with fastembed, so the agent can
  recall relevant earlier turns and the sidebar can search chats by meaning.
- **Observational memory**: a background Observer distills durable facts from the
  conversation and a Reflector compresses them, shown in the Memory panel.

Memory is for what was said. Knowledge is for what the team knows: curated pages the
agent searches, reads and cites.
