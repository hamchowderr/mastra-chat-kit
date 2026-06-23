# Polish 01 — Manual Studio Test

The original verification test #4 was "click around in Studio and confirm the agent works." That can't be automated because it tests the human UX. This step does it deliberately.

## Why this matters

Mastra Studio is the development experience the owner ships to clients. If a client opens Studio and the agent feels broken (slow, missing tools, weird trace output), the template fails its purpose regardless of whether typecheck and CI pass.

## Steps

### 1. Boot the dev server

```bash
cd C:\Users\HamCh\code\template-mastra-base
npm run dev
```

Wait for "Mastra Studio ready" or equivalent. Should take under 5 seconds.

### 2. Open Studio

Visit `http://localhost:4111` in a browser.

**Pass criteria for the landing page:**
- Studio loads without errors
- `leadIntake` agent appears in the agent list/sidebar
- No red error banners or warnings about missing config

### 3. Open the leadIntake agent

Click into `leadIntake`. You should see:

**Pass criteria:**
- Agent name and description visible
- Chat interface ready to accept input
- Tool list shows `validateEmail` (or however Studio displays attached tools)
- Scorer list shows three scorers: hallucination, completeness, urgency
- Memory panel shows empty (no prior threads)

### 4. Send a canonical input

Paste this into the chat:

```
Hi, this is John Smith from Acme Corp (john@acme.io). We need pricing for 50 seats by Friday.
```

**Pass criteria for the response:**
- Agent responds within ~5 seconds
- Response is structured JSON matching `LeadSchema`
- Fields populated correctly:
  - `name`: "John Smith"
  - `email`: "john@acme.io"
  - `company`: "Acme Corp"
  - `intent`: "pricing"
  - `urgency`: "high"
  - `notes`: present and non-empty
- No fabricated fields

### 5. Inspect the trace

Open the trace view for the request you just sent. You're checking that observability is working.

**Pass criteria:**
- Trace appears in the trace list
- Span hierarchy shows: agent run → LLM call → tool call (validateEmail)
- Tool call shows input (`{ email: "john@acme.io" }`) and output (`{ valid: true, normalized: "john@acme.io", reason: null }`)
- Total duration is reasonable (< 10s)
- No error spans

### 6. Test fail-mode behavior

Send another input that should NOT have an email:

```
Hi, I'm interested in your platform but I'm not ready to share contact info yet.
```

**Pass criteria:**
- Response has `email: null`
- Response has `name: null` (it's "I" but not a real name)
- The validateEmail tool was NOT invoked (verify in trace)
- This is the anti-hallucination behavior — agent refused to fabricate

### 7. Test memory persistence

Send a third message in the same thread:

```
Actually, my email is jane.doe@example.com — I forgot to include it earlier.
```

**Pass criteria:**
- Agent's response uses jane.doe@example.com (memory carried context)
- Trace shows memory was loaded at the start of the run
- Database side: confirm memory persisted to Supabase Postgres (if you can quickly check, optional)

### 8. Send a request via cURL while Studio is running

In a separate terminal:

```bash
curl -X POST http://localhost:4111/api/agents/leadIntake/generate ^
  -H "Content-Type: application/json" ^
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"URGENT - production down\"}]}"
```

(Use `^` for line continuation on Windows cmd, or backslashes in Git Bash / PowerShell.)

**Pass criteria:**
- HTTP 200 response
- Response includes `urgency: "high"`, `intent: "support"`
- The request shows up as a NEW trace in Studio (live updating)

## What to capture in PROGRESS.md

```
## Polish 01: Manual Studio Test
- Status: complete | blocked
- Steps 1-8: <pass/fail for each>
- Notes: <any quirks observed; e.g. "trace took 12s to populate", "tool list rendered as JSON not pretty">
- Issues to fix: <list, or "none">
```

## If anything fails

Don't fix it yet — just document. The owner will decide which issues are blockers vs. nice-to-haves before publishing to GitHub. Some issues might actually be Mastra bugs, not template bugs.

## Stop after this step

Wait for owner to review your PROGRESS.md entry before moving to Polish 02. If everything passed cleanly, the owner will say "continue."
