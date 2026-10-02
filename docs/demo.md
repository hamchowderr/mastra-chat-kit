# Live demo script (AIMock, no keys, no network)

A 3–4 minute walk through the kit for a live audience. Every model call is answered
by [AIMock](https://aimock.copilotkit.dev) fixtures in
`packages/server/fixtures/chat.json`, so the demo costs nothing, needs no API keys,
and behaves the same every time. Once it is set up it needs no network either.

| # | Beat | Shows | Clicks |
|---|---|---|---|
| 0 | Weather | a tool approval gate | Approve |
| 1 | Research | reasoning, two searches, sources + citations | Always allow read tools |
| 2 | Plan mode | Plan toggle → plan card → Chat mode → live task checklist | Plan, Approve, Approve plan |
| 3 | Code subagent | a subagent writes and runs code; Files + Terminal | Approve, Approve |
| 4 | ask_user | the agent asks you a question mid-run | Playful |
| 5 | Image | image generation | Approve |
| 6 | Schedules | a recurring job in the Schedules tab | Approve |

**Type the prompts exactly as written.** Each one is matched verbatim by a fixture;
anything else gets the catch-all reply ("I'm the mastra-chat-kit reference assistant
(running on AIMock…"). If you see that line on stage, the prompt had a typo.

---

## Before the day (while you still have internet)

Everything the demo downloads, it downloads the first time. Do all of this at home.

1. **Install**, from the repo root: `pnpm install`.
2. **Server env.** Create `packages/server/.env`. A shell variable won't work, because
   the server loads this file over the process environment:

   ```dotenv
   APP_SECRET=local-demo-secret-at-least-32-characters
   USE_AIMOCK=true
   AIMOCK_URL=http://127.0.0.1:4010
   # env.ts refuses to start without a provider key, even under AIMock. Any value works:
   ANTHROPIC_API_KEY=mock
   OPENAI_API_KEY=mock
   # Stop Mastra fetching provider data from models.dev. That fetch has no timeout,
   # so on bad venue wifi it can stall a run.
   MASTRA_OFFLINE=true
   MASTRA_TELEMETRY_DISABLED=1
   ```

3. **Build the web app**: `pnpm --filter @mastra-chat-kit/web build`. Serve the
   production build, not `next dev`. The dev server's HMR socket can break hydration,
   and the build self-hosts the Geist fonts, which `next dev` fetches from Google.
4. **Rehearse once end to end** (see [Rehearsal](#rehearsal)). The first message
   downloads the local embedding model (~130 MB, fastembed `bge-small`) into your user
   cache. After that, semantic recall runs offline.
5. **Reset** (`pnpm demo:reset`, below) so the machine is clean for the talk.

Observational memory is **off** under `USE_AIMOCK`. Its Observer needs a real model:
it must answer with blocks keyed by live thread ids, and its request replays the whole
conversation, so under AIMock it would match these demo fixtures and fill the Memory
panel with junk. So the **Memory tab stays in its empty state** during the demo. Don't
open it.

## Start the stack (three terminals, from the repo root)

```bash
pnpm --filter @mastra-chat-kit/server dev:mock      # 1. AIMock on :4010
pnpm --filter @mastra-chat-kit/server dev           # 2. Mastra server on :4111
pnpm --filter @mastra-chat-kit/web start            # 3. web on :3000 (the build from step 3)
```

Open <http://localhost:3000>. Use a browser window **at least 1600 px wide**, or
collapse the conversation sidebar (the panel icon at its top left) before step 6. At
1440 px, the Schedules tab sits past the right edge of the workbench.

## Reset: before every run

```bash
# stop the server (Ctrl+C in terminal 2), then:
pnpm demo:reset
# start the server again
```

A run leaves state behind:

- The threads it created. Semantic recall pulls them into later chats, and they fill
  the sidebar with duplicates.
- A persisted weekday schedule.
- The workspace files. A second run's `fizzbuzz.js` write would hit the existing file,
  and its tool card would never finish.
- The "Always allow read tools" grant. It lives in the server's memory, so beat 0's
  approval card wouldn't appear.

Restarting the server clears the grant. `pnpm demo:reset` deletes the rest:

- the libSQL database;
- the DuckDB store;
- the agent's workspace.

It refuses to run while the server is up, because the server holds the database open.

> **Where the database actually is.** Under `mastra dev` the server runs from
> `packages/server/src/mastra/public/`, so the database it writes is
> `packages/server/src/mastra/public/mastra.db`, **not** `packages/server/mastra.db`.
> Deleting only the latter resets nothing. `demo:reset` clears both, along with the
> `-wal`/`-shm` sidecars and `src/mastra/public/agent-workspace/`.

AIMock and the web server can stay up between runs.

---

## The script

Click **New chat** (top of the sidebar) before every beat except the first.

### 0. Weather: the approval gate (~20 s)

Type:

```text
What's the weather in Los Angeles?
```

- **Steps** trace ("Called getWeather") and a **Run getWeather?** card with the tool's
  real arguments. Buttons: *Approve*, *Always allow read tools*, *Reject*.
- Click **Approve**. The reply reads "The weather in Los Angeles looks clear right now."

> Don't expand the getWeather tool card. Its real output is `27 °C, Rainy` while the
> fixture's reply says "clear". The e2e suite pins that sentence, so it wasn't changed.

*Say:* every side effect waits for a human decision.

### 1. Research with sources (~25 s)

**New chat**, then:

```text
Research what the AgentController does and cite your sources.
```

- A collapsed **reasoning** block, then **Run searchKnowledge?**
- Click **Always allow read tools**. The second search runs **without** a card: the
  grant covers every read tool for the rest of the session.
- Two searchKnowledge cards, each with **Used 2 sources** and **Citations: [1] [2]**
  (hover a citation). Then the answer, citing both documents by title.

No network is involved: `searchKnowledge` is a local tool returning deterministic
documents. The `docs.example.com` links are placeholders, so **don't click them**.

### 2. Plan mode → approve → live checklist (~45 s)

**New chat.** Click **Plan** in the composer (left of the `+`) so it's highlighted,
then:

```text
Plan a weather briefing for Tokyo, Paris and New York, then carry it out.
```

- The agent writes its plan to the workspace first: **Run
  mastra_workspace_write_file?** Click **Approve** (not "Always allow edit tools").
- A **plan card**: *Weather briefing: Tokyo, Paris, New York*, "Proposed by the agent ·
  plans/weather-briefing.md", four steps, and **Approve plan** / **Reject**.
- Click **Approve plan**. The footer changes to *"Plan approved · switched to Chat
  mode to carry it out."* and the **Plan** toggle switches itself off.
- The agent carries on by itself. A **Tasks (4)** checklist appears and ticks through
  `[in_progress]` → `[completed]` as getWeather runs for each city, with no approval
  cards because of beat 1's grant.
- It ends with a **Weather briefing**: Tokyo 24 °C clear, Paris 21 °C cloudy, New York
  21 °C cloudy. Those are the tools' real outputs.

*Say:* Plan mode is the controller's mode, not a prompt trick. Approval switches the
session back to Chat mode, and the run resumes on the same turn.

*(Clicking **Reject** instead gets "No problem — tell me what you'd like changed…")*

### 3. Code subagent: Files + Terminal (~35 s)

**New chat.** Open the workbench first (the panel icon, top right), on **Files**:

```text
Have the code subagent build a FizzBuzz script and run it.
```

- **Run subagent?** Click **Approve**.
- A **Subagent · code** card shows the task, then its own tool calls,
  `mastra_workspace_write_file` and `mastra_workspace_execute_command`, both
  *Completed*, and its summary. A subagent's tools don't ask for approval.
- **fizzbuzz.js** appears in **Files**, which refreshes live while the agent runs.
  Click it to show the code.
- The parent re-runs the script to check it: **Run mastra_workspace_execute_command?**
  Click **Approve**.
- Switch to **Terminal**: `1 2 Fizz 4 Buzz … 14 FizzBuzz`. That's real output from
  `node` in the sandbox.

*(The Terminal shows only commands the main agent runs. That's why the parent re-runs
the script instead of relying on the subagent's run.)*

### 4. ask_user: the agent asks you (~15 s)

**New chat**:

```text
Draft a one-line announcement for tonight's meetup.
```

- A **QUESTION** card: *What tone should the announcement have?* with **Playful** and
  **Professional**.
- Click **Playful**: *"Tonight: live agents, zero API keys, and one very brave demo.
  Come watch it not break. 🍕"*
- (**Professional** gets a sober line instead. The answer really steers the run.)

### 5. Image generation (~10 s)

**New chat**:

```text
Generate an image of a sunset over the mountains.
```

- **Run generateImage?** Click **Approve**.
- A sunset over purple mountains renders inline, then "Here is your sunset over the
  mountains." It's a real 256×256 PNG served by AIMock's image endpoint.

### 6. Schedules: a recurring job (~15 s)

**New chat**:

```text
Every weekday at 9am, remind me to post my standup update.
```

- **Run start_schedule?** Click **Approve**. Recurring background work is always
  gated.
- Open the **Schedules** tab (collapse the sidebar first on a narrow screen):
  **Weekday standup reminder**, *Active*, `0 9 * * 1-5`, "next in …".

It fires at 09:00 on weekdays, so it won't go off during an evening talk. If it ever
does fire, its prompt has its own fixture: *"⏰ Standup time — post your update in the
team channel."* `pnpm demo:reset` deletes it.

---

## Order matters, and why

The fixtures don't depend on the order: every hop after a flow's first is matched by
the id of the tool call before it (see below). Two things still do:

- **Weather before research.** "Always allow read tools" in beat 1 covers getWeather
  for the rest of the session. After it, beat 0 would have no approval card to show.
- **Research before plan.** The same grant lets the plan's three weather checks tick
  through the checklist without three approval cards.

## Rehearsal

With the stack running on a freshly reset server:

```bash
pnpm demo:rehearse
```

It drives Playwright's Chromium: run `pnpm --filter @mastra-chat-kit/web exec playwright
install chromium` once (the e2e suite needs it too), or set `CHROMIUM_PATH` to another
Chromium. `packages/web/scripts/demo-rehearsal.mjs` clicks through beats 0–6 exactly as above.
Each step waits for the text the audience should see, fails if a reply ever falls
through to the catch-all, and saves a screenshot per beat to
`packages/web/demo-rehearsal/`. Set `HEADED=1` to watch it. It leaves the server in
the post-demo state, so **reset again afterwards**.

## Known cosmetic issues

- The model picker ("Sonnet 4.6") loads its provider logo from `models.dev`. Offline,
  it shows a small broken-image icon. The icon comes from vendored AI Elements code,
  so it wasn't patched here.
- The Los Angeles thread in the sidebar is titled with the reply text. Under AIMock,
  the title request for that prompt is answered by the weather fixture.

## How the fixtures work

- **Where:** a `DEMO FLOWS` block at the top of `packages/server/fixtures/chat.json`.
  AIMock's config (`aimock.json`) takes a single `fixtures` path. A directory would
  load files in name order, putting `chat.json`'s catch-all ahead of any demo file. The
  catch-all stays last.
- **First hop:** the opening prompt plus `hasToolResult: false`, like the existing
  fixtures.
- **Every later hop:** `toolCallId`. Each fixture gives its tool call a fixed id
  (`toolu_demo_…`), and the next request ends with that call's result, so the next hop
  matches on it. That's exact per hop and unaffected by semantic recall or history.
  `turnIndex` counts assistant messages, and `hasToolResult` is true for every hop
  after the first, so neither can pick out one hop of a ten-step chain.
- **Subagents:** matched on the code subagent's system prompt ("coding subagent")
  **plus** the task text, so the older `hello.txt` fixture is untouched.
- **Titles:** each flow has a title fixture (`systemMessage: "3-6 word title"` plus
  its prompt), which names the sidebar entry.

**Proof:** `packages/server/tests/integration/demo-fixtures.test.ts` drives every flow
through a real AgentController in the dev configuration. It reads AIMock's request
journal to assert that every model call, each hop included, was served by that flow's
own fixtures and never the catch-all. It also checks that observational memory is off
under `USE_AIMOCK` and on without it.

**Changing a prompt** means changing it in three places: the fixture, this document,
and `demo-rehearsal.mjs`. The test and the rehearsal both fail if they drift.
