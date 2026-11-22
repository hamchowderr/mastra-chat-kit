---
description: What the Mastra AgentController (the Agent Harness) adds around the chat agent.
---
# Mastra AgentController

The AgentController (announced by Mastra as the Agent Harness) wraps one agent with the
orchestration a plain model stream can't carry:

- **Sessions and threads**: each user gets a Session, and each conversation is a thread
  stored in libSQL.
- **Modes**: Chat mode does the work; Plan mode can only read, write a plan file and call
  `submit_plan`.
- **Subagents**: the chat agent delegates to code, research, writer, review and data
  specialists through the built-in `subagent` tool.
- **Task tracking**: `task_write`, `task_update` and `task_complete` drive the task list
  in the UI.
- **Tool approvals**: tool calls with side effects wait at an approval gate (see
  [[Tool approvals]]).

Everything it does is emitted as typed controller events, which the web layer streams over
SSE and renders onto AI Elements.
