# Base Polish 04 — Push to Main

Final step. Commit, push, watch CI go green. **No new git tag** — owner explicit decision, main updates only.

## Step 1: Pre-flight

```bash
cd C:\Users\HamCh\code\template-mastra-base
git status
```

Verify nothing sensitive is staged:
- `.env` should NOT be tracked
- `node_modules/` should NOT be tracked
- `package-lock.json` updates are expected

If anything sensitive appears, fix `.gitignore` first.

## Step 2: Commit

```bash
git add .
git commit -m "Configure standard reachability stack

Brings template up to family standard:
- @mastra/editor: non-developer agent iteration via Studio Editor
- @mastra/mcp: MCPServer exposing agents to MCP-compatible clients
- editor storage domain in MastraCompositeStore
- README documents REST/A2A/MCP/Studio reachability
- AGENTS.md documents reachability conventions"
```

## Step 3: Push to main

```bash
git push origin main
```

**No tag.** Owner explicit decision.

## Step 4: Watch CI

```bash
& 'C:\Program Files\GitHub CLI\gh.exe' run watch --repo hamchowderr/template-mastra-base
```

**Pass criteria**: All four CI jobs green: typecheck, build, eval, docker.

If any job fails:

| Failure | Likely cause | Fix |
|---|---|---|
| `build` red, missing `@mastra/mcp` types | Package not in dependencies | Verify Polish 01 ran — `@mastra/mcp` should be in `package.json` |
| `build` red, "agent has no description" | leadIntake agent missing description | Re-check Polish 02 Step 1 — description must be non-empty |
| `eval` red, agent not found | MCP server registration broke agent registration | Verify `agents` field still contains leadIntake in Mastra constructor |
| Storage init error | Editor storage domain mis-keyed | Re-check Polish 01 — domain key must be exactly `editor` |

If something fails that isn't on this list, write to PROGRESS.md and stop.

## Step 5: Final wrap-up entry in PROGRESS.md

```markdown
## Base Polish — Standard Reachability + Editor Configuration — COMPLETE

- Status: complete
- All 4 polish steps:
  - 01 Install Packages + Editor Storage: pass
  - 02 Configure MCPServer + MastraEditor: pass
  - 03 Verify + Document Reachability: pass
  - 04 Push to Main: pass
- Repo: https://github.com/hamchowderr/template-mastra-base
- CI: green on main
- Packages installed: @mastra/editor, @mastra/mcp
- Files changed: package.json, package-lock.json, src/mastra/index.ts, README.md, AGENTS.md, src/mastra/agents/_example.ts (description if added)
- No new tag pushed
- Recommended next action: apply same polish to template-mastra-voice
```

You're done with base. Move to template-mastra-voice next.
