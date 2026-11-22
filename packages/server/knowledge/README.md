# Sample knowledge

The chat agent's knowledge base, mirrored into Mastra Knowledge (scope `org:chat-kit`)
every time the server boots. Each markdown file here is one page, at its path without
`.md`: `guides/tool-approvals.md` is `org:chat-kit#guides/tool-approvals`. The page name is
the frontmatter `name`, else the first `# heading`, else the file name; a frontmatter
`description` becomes the page description.

Edit a file and restart: the page updates. Delete a file: its page is removed. `README.md`
files (like this one) are skipped. Point `KNOWLEDGE_DIR` at your own folder to replace
these samples.
