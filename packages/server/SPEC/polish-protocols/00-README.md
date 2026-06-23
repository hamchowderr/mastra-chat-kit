# Base Polish — Standard Reachability + Editor Configuration

Brings the base template up to the family's standard configuration.

Every template in this family ships with:

- **REST** — automatic HTTP endpoints for every agent (already working)
- **A2A** — agent-to-agent protocol endpoints, automatic (already working)
- **MCP** — `MCPServer` exposing every agent as a callable tool (this polish adds)
- **Studio** — visual UI on `mastra dev` (already working)
- **Editor** — `@mastra/editor` for non-developer agent iteration (this polish adds)

These are not optional. Any template missing them is incomplete and must be brought to standard before being considered production-ready.

This polish brings `template-mastra-base` to standard at `https://github.com/hamchowderr/template-mastra-base`.

## Read these files in order

1. **`00-README.md`** (this file) — operating instructions
2. **`01-install-and-storage.md`** — install required packages, configure editor storage domain
3. **`02-configure-reachability.md`** — configure MCPServer and MastraEditor
4. **`03-verify-and-document.md`** — verify all four endpoints respond, document in README and AGENTS.md
5. **`04-push-to-main.md`** — commit, push to main, watch CI

## Operating mode

- **Stop after each polish step**, write to `SPEC/PROGRESS.md`, wait for "continue".
- **No new git tag.** This polish updates main only. Owner explicit decision.
- **Don't refactor working code** — only what these specs explicitly call for.
- **Time budget**: 60 minutes total.

## Reporting

After all 5 polish steps, write to `PROGRESS.md`:

```
## Base Polish — Standard Reachability + Editor Configuration
- Status: complete | blocked
- All 5 polish steps: <list with pass/fail>
- Packages installed: @mastra/editor, @mastra/mcp
- Files changed: src/mastra/index.ts, README.md, AGENTS.md, package.json, src/mastra/agents/_example.ts (description if needed)
- CI run: <status>
- Notes: <anything unexpected>
```
