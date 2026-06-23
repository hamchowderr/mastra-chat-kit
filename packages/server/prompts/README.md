# Prompts

Parameterized prompts for AI coding agents working on this template. Pass one of these to Claude Code (or any capable coding agent) to generate complete, convention-compliant output.

## Available

| Prompt | Purpose |
|---|---|
| [build-agent.md](./build-agent.md) | Add a new Mastra agent: schema, tools, scorers, dataset, registration |

## Planned

| Prompt | Purpose |
|---|---|
| `build-tool.md` | Add a standalone shared tool in `src/mastra/tools/` |
| `build-scorer.md` | Add a custom scorer with dataset cases |
| `build-workflow.md` | Add a Mastra workflow with steps and triggers |
| `deploy-vps.md` | Deploy the agent to a VPS with PM2, nginx, and SSL |
| `client-kickoff.md` | Spin up a new client project from this template |
| `debug-agent.md` | Diagnose and fix a failing agent or eval case |

## Usage

Copy the prompt content, fill in the `## Inputs` section at the top, then paste into your AI coding agent session. The prompt includes all conventions from `AGENTS.md` so the agent doesn't need to read it separately.
