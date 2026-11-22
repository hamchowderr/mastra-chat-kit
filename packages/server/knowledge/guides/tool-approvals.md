---
description: How the approval gate works, and what "Always allow" grants.
---
# Tool approvals

A tool call with side effects parks at the AgentController's approval gate until the user
answers the card:

- **Approve** runs this one call.
- **Decline** returns "not approved" to the model, which carries on without it.
- **Always allow** approves the tool's category (read, edit, execute, other) for the rest
  of the session.

Categories are chosen so a grant never covers more than the user would expect: deleting a
file, setting a goal, starting a schedule or delegating to a subagent have no category, so
each call asks. Lookups that change nothing, such as web search and task tracking, run
without a card.
