# Registry — installing the chat layer

`mastra-chat-kit` ships its web chat layer as a **shadcn registry** so other
projects install the same canonical components instead of hand-copying and
drifting. It is built on [Vercel AI Elements](https://elements.ai-sdk.dev): we
**depend on Vercel's AI Elements registry** for the untouched elements and ship
our own copies of only the few we had to patch.

## What's in the registry

`packages/web/registry.json` (built to `packages/web/public/r/*.json`):

| Item | Type | What it is |
|---|---|---|
| `chat` | block | **The full skin** — history sidebar │ conversation │ the 4-tab workbench (browser, files, memory, schedules). **Install this for the complete experience.** |
| `chat-minimal` | block | **A second skin** — conversation + composer + approvals only, no sidebar or workbench. For embedding an agent in a corner of an existing app. |
| `chat-composer` | component | The one composer `chat` and `chat-panel` use: attachments, dictation, optional model picker and web search, and the Plan toggle (`plan-mode`). |
| `chat-panel` | block | **A third skin** — a docked side panel: a header (title, conversation history, new chat, your own buttons), a greeting and suggestions when empty, and a rounded composer card with the Plan toggle (hide it with `plan={false}`). No model picker, no web search. |
| `chat-tool-views` | component | Shared renderers turning real tool output into elements (sources, generated images, plan, goal card, `ask_user`). Used by **every** skin. |
| `chat-engine` | lib | The engine: Agent Controller SSE client, transcript reducer, and the data hooks that own every `/api/*` call. UI-free — imports only React. |
| `chat-routes` | block | Same-origin Next route handlers + `mastra-proxy.ts` that forward to a Mastra server — chat, threads, the full `agent-controller/*` surface, workspace, and browser screencast. Pulled in automatically by `chat`. |
| `chat-server` | file | **The other half.** The 16 Mastra endpoints `chat-routes` forwards *to*, for your own Mastra project. Not pulled in by `chat` — install it separately, on the server side. |
| `code-block` | component | AI Elements code block **+ our SSR hydration fix** (mount-gated Shiki). |
| `image` | component | AI Elements image with `uint8Array` optional (renders from base64). |
| `context` | component | AI Elements context/usage with `Partial<LanguageModelUsage>`. |
| `tool` | component | AI Elements tool display, rewired to our local `code-block`. |
| `agent` | component | AI Elements agent/tool roster with a strict-TS fit — a `Tool` `description` may be a function, so it's narrowed before render. |

Everything else (`message`, `conversation`, `reasoning`, `prompt-input`, …) is
pulled straight from Vercel's registry at install time, and shadcn/ui primitives
(`button`, `dialog`, …) from the default shadcn registry.

### Skins: one engine, different looks

The look and the engine are separate items, so you can swap the first without
losing the second:

```bash
npx shadcn@latest add @mastra-chat-kit/chat           # full shell
npx shadcn@latest add @mastra-chat-kit/chat-minimal   # embeddable
npx shadcn@latest add @mastra-chat-kit/chat-panel     # docked side panel
```

All three drive the **same** `AgentController` session — same threads, same tool
approvals, same subagents, same workspace. They differ only in layout.

**To author another skin:** render over `useAgentControllerChat()` from
`chat-engine`, reuse `chat-tool-views` for tool output, and add it to
`gen-registry.mjs` with `registryDependencies: [chat-engine, chat-routes,
chat-tool-views]`. Two rules the build enforces for you:

- **Skins must never import each other.** Anything two skins share belongs in
  `chat-tool-views` (or the engine). `validate()` check (4) fails the build if an
  item imports a file another item ships without declaring that dependency.
- **Approvals and `ask_user` are not optional.** Every tool is gated and
  `ask_user` suspends the run, so a skin without `<Confirmation>` and
  `<AskUserPrompt>` leaves the agent parked with no way to continue. Layout is a
  choice; those two are the contract.

Colors and fonts need no work at all — the registry ships **no** `cssVars`, so any
skin inherits the consuming project's own shadcn theme.

### Why only 5 components are vendored

Vercel AI Elements is consumed shadcn-style (source copied into your repo). We
keep all of it tracking upstream **except** four files we had to patch, plus
`tool` (its file is unchanged — we only repoint its dependency at our patched
`code-block`):

- **`code-block`** — real SSR bug: a module-level Shiki cache warms on the server
  but is cold on each fresh client, so server HTML ≠ client's first render →
  React hydration mismatch. We gate highlighting on mount.
- **`image`** — `uint8Array` made optional; the element renders from `base64`.
- **`context`** — `usage` relaxed to `Partial<…>`; it reads only flat fields.
- **`agent`** — a `Tool`'s `description` can be a *function*, which is not a
  `ReactNode`; upstream renders it directly, so a consumer install failed
  `next build`. We narrow it to a string first. (Found by `bd
  mastra-chat-kit-l3f` — the fix already existed in this repo but wasn't shipped.)

These are tracked in `bd mastra-chat-kit-k5f` to upstream to Vercel; once merged
we drop the overrides and depend 100% on upstream.

**Attribution:** the 5 redistributed files are adapted from Vercel AI Elements
(Apache-2.0, © 2023 Vercel) — see [`packages/web/NOTICE`](../packages/web/NOTICE)
for the per-file change statements required by the License.

## Consuming the registry

### Prerequisites

A shadcn-initialized project on the **Radix base** with the **Lucide** icon
library. Both are required:

```bash
npx shadcn@latest init --base radix
```

Then confirm `components.json` says `"iconLibrary": "lucide"` — set it if the
preset you picked chose something else, and re-run `shadcn add spinner --overwrite`
if you already installed:

```json
{ "iconLibrary": "lucide" }
```

> **Why Lucide matters.** Every component in this kit imports from `lucide-react`.
> There is also a concrete break: on a `hugeicons` project, shadcn's own
> `ui/spinner.tsx` renders `<HugeiconsIcon strokeWidth={…}>` while typing its props
> as `React.ComponentProps<"svg">`, where `strokeWidth` is `string | number` — it
> does not fit HugeiconsIcon's `number`, and `next build` fails. Reproduced in a
> bare shadcn project with none of this kit installed, so it is a shadcn issue, not
> ours — but Lucide sidesteps it.

**Verified end-to-end** (shadcn CLI 4.16.0, Next 16.2.6, 2026-07-29): a fresh
`init --base radix` project with `iconLibrary: lucide`, after
`shadcn add @mastra-chat-kit/chat`, gives **0 type errors and `next build` exits 0**.

> **Do not run a bare `npx shadcn@latest init`.** Since CLI 4.x the default is
> Base UI, not Radix — `--defaults` resolves to `--preset=base-nova` (verified on
> 4.16.0, 2026-07-29). This kit is authored against Radix and will not build on a
> Base UI project. See [Why Radix is required](#why-radix-is-required).

That provides the theme the chat layer assumes: the full token set (incl.
`sidebar-*`), the `@theme inline` mapping, `tw-animate-css`, and
`@custom-variant dark`. The components use only **standard** shadcn tokens, so
they inherit your chosen `baseColor` — the registry deliberately ships **no**
`cssVars` (it won't override your palette).

#### Why Radix is required

The kit's own files import **zero** Radix packages directly, and — measured, not
assumed — **our own components install cleanly onto either base.** The shadcn CLI
rewrites `asChild` into Base UI's `render` prop during `add`, so
`<DropdownMenuTrigger asChild>` in our source becomes
`<DropdownMenuTrigger render={…}>` on a Base UI project, and typechecks.

What does *not* survive the transform is the **upstream AI Elements** we depend
on. Measured on shadcn CLI 4.16.0 / Next 16.2.6 (2026-07-29), `tsc --noEmit`
after `shadcn add @mastra-chat-kit/chat` into a freshly-`init`ed project:

| Consumer setup | Type errors | Where |
|---|---|---|
| `radix` + Lucide | **0** | — builds clean, `next build` exits 0 |
| `radix` + `hugeicons` | 1 | shadcn's own `ui/spinner` (not ours; see above) |
| `base-nova` (Base UI) | 12 | all upstream — see the breakdown below |

Vercel's elements are authored against Radix; on a Base UI project the transform
leaves them with Base UI primitives they weren't written for. That is why Radix
is the supported base.

#### The Base UI failures, measured

Reproduce with `node packages/web/scripts/registry-smoke.mjs --base base --report`
— it installs onto Base UI and prints the errors grouped by file instead of
asserting. Measured 2026-08-02, shadcn CLI 4.16.0 / Next 16.2.6:

| File | Errors | Cause |
|---|---|---|
| `prompt-input.tsx` | 7 | 4 × `BaseUIEvent<…>` vs `Event` handler signatures, 3 × `openDelay`/`closeDelay` |
| `attachments.tsx` | 3 | `openDelay`/`closeDelay` on PreviewCard |
| `inline-citation.tsx` | 1 | `openDelay` on PreviewCard |
| `plan.tsx` | 1 | `ButtonProps` mismatch |

Two root causes account for 11 of the 12: **`openDelay`/`closeDelay` do not exist
on Base UI's PreviewCard** (7), and **Base UI wraps handler events in
`BaseUIEvent<…>`** (4). The last is a `ButtonProps` shape mismatch in `plan`.

The first measurement found **13**, and one of them was in a file we ship —
`context.tsx`, one of the five vendored elements, also passed `openDelay`. Earlier
notes here claimed every Base UI failure was upstream's; that was wrong. Ours is
fixed (it spreads the delay props instead of naming them), which is why the count
is 12 and the table above is all upstream.

The `openDelay` family is fixed upstream in
[vercel/ai-elements#473](https://github.com/vercel/ai-elements/pull/473) —
verified on a Base UI project to take an unpatched consumer from 15 errors to 7.
When that merges and releases, this table loses 7 more rows. The remaining
`BaseUIEvent` and `ButtonProps` errors have no fix filed; they are reported in
[#446](https://github.com/vercel/ai-elements/issues/446) and tracked in
`bd mastra-chat-kit-68j`.

`nova` is the preset and `base` the primitive library; the resulting `style` is
`base-nova`. `shadcn init --help` advertises `--defaults` as `--preset=base-nova`,
but the preset validator rejects that value — valid presets are `nova`, `vega`,
`maia`, `lyra`, `mira`, `luma`, `sera`, `rhea`.

> For the record, the two upstream elements that import `@radix-ui/…`
> (`reasoning`, `chain-of-thought`) are *not* the problem — they use only
> `@radix-ui/react-use-controllable-state`, a base-agnostic hook that Vercel's
> registry items already declare in their own `dependencies`.

In the consumer project's `components.json`, add the namespace:

```json
{
  "registries": {
    "@mastra-chat-kit": "https://mastra-chat-kit-registry.vercel.app/r/{name}.json"
  }
}
```

> The registry is served as a plain static site — `pnpm build:registry` writes the
> item JSON to `packages/web/public/r/`, and that directory is deployed on its own.
> It needs no framework and no build step, so registry hosting is independent of
> wherever the demo app runs.

### Publishing it

```bash
pnpm --filter @mastra-chat-kit/web deploy:registry            # build → stage → deploy
pnpm --filter @mastra-chat-kit/web deploy:registry --dry-run   # stage only, don't deploy
```

`scripts/deploy-registry.mjs` is the only supported way to publish. It rebuilds
the registry (deploying a stale `public/r` is the failure this exists to
prevent), stages `registry-site/` + `public/r` together, links the Vercel project
**by name**, and deploys. Run it after any change that alters `registry.json`.

The shell lives in `packages/web/registry-site/`: `index.html` (the landing page
the bare URL serves) and `vercel.json` (CORS + cache headers on `/r/*`).

Three details that will bite anyone editing this:

- **Staging happens in the OS temp dir, not the workspace.** Vercel walks up from
  the deploy directory hunting for a `package.json` to detect the framework;
  staging under `packages/web` makes it find the Next.js one and fail with
  `No Next.js version detected`.
- **`vercel.json` sets `framework: null`, `buildCommand: ""`, `outputDirectory: "."`.**
  All three override whatever the Vercel project has stored. Without the empty
  build command the project tries to run the web app's
  `pnpm build:registry && pnpm build` against a directory with no `package.json`.
- **Link by project name.** Vercel otherwise infers the project from the staging
  directory's name and silently creates a new one.

The daily `registry-smoke` workflow asserts the deployed URL answers, so a dead
deployment surfaces there rather than in someone's terminal. Pull requests skip
that assertion — a down deployment is production news, not a broken diff.

Then install the whole chat layer:

```bash
npx shadcn@latest add @mastra-chat-kit/chat
```

### The server half

`chat` gives you a UI that fetches `/api/agent-controller/*`. Those Next routes
forward to a Mastra server at `MASTRA_SERVER_URL` (default
`http://localhost:4111`) — and the 16 endpoints they call are **not** Mastra
built-ins. Point the UI at a stock `mastra dev` and every request 404s.

So install the other half into your Mastra project:

```bash
npx shadcn@latest add @mastra-chat-kit/chat-server
```

Seven files — the three route modules, the SSE forwarder they share, the helper
that reads which user a request is for, the `ChatServerDeps` type, and one pure
formatting helper. Then register them and supply the dependencies:

```ts
import { createThreadRoutes } from './mastra/routes/threads';
import { createControllerRoutes } from './mastra/routes/controller';
import { createWorkspaceRoutes } from './mastra/routes/workspace';

const deps = {
  getSession, getAgentController, getBrowser,   // your AgentController;
                                                 // getSession(resourceId?) → that user's Session
  agentId: 'chat',
  workspace: { root, readTree, readFile },
  getImage,
  modelAllowlist: new Set([...]),
  search: { embed, query },                      // OPTIONAL — omit it and
};                                               // /threads/search returns []

export const mastra = new Mastra({
  server: {
    apiRoutes: [
      ...createThreadRoutes(deps),
      ...createControllerRoutes(deps),
      ...createWorkspaceRoutes(deps),
    ],
  },
  // …your agents, your storage
});
```

The routes take their dependencies rather than importing ours, so **none of this
repo's agents, storage, Dolt wiring or env schema comes with them** — see
`packages/server/AGENTS.md` for why that seam exists. `packages/web/scripts/server-smoke.mjs`
proves it on every relevant PR: it installs into a plain TypeScript project with
no React and asserts no shipped file reaches back into this repo.

shadcn resolves the dependency graph automatically: our 5 vendored components +
`chat-engine` + `chat-routes` from `@mastra-chat-kit`, the other AI Elements from
Vercel, and the shadcn/ui primitives from the default registry. (Individual items
also install, e.g. `npx shadcn@latest add @mastra-chat-kit/code-block`.)

Installing `chat` pulls **32 files from this registry**, plus everything they
resolve to upstream:

| | Files | From |
|---|---|---|
| `components/chat/*.tsx` | 10 | this registry (`chat`) |
| `app/api/**/route.ts` + `lib/mastra-proxy.ts` | 15 | this registry (`chat-routes`) |
| `lib/agent-controller/*` | 2 | this registry (`chat-engine`) |
| `components/ai-elements/*.tsx` | 5 | this registry (the patched ones) |
| **Subtotal — ours** | **32** | |
| `components/ai-elements/*.tsx` | 17 | Vercel's registry, by URL |
| `components/ui/*.tsx` | — | the default shadcn registry, resolved transitively |

> Only the "ours" counts are pinned. Upstream counts drift as Vercel and shadcn
> change, which is exactly why they aren't asserted here — `registry-smoke.mjs`
> does a real install and checks the three numbers that are ours to keep correct
> (10 chat components, 14 route handlers, 5 vendored elements), on every relevant
> PR and nightly.

### Wire it to a Mastra server

The UI is pure frontend; it talks to a Mastra server over same-origin Next route
handlers (the `chat-routes` item) that proxy to `MASTRA_SERVER_URL`:

```bash
# .env.local
MASTRA_SERVER_URL=http://localhost:4111   # default if unset
```

Point it at the kit's own `server` package (or any Mastra server) that exposes
this contract — the routes proxy 1:1:

| Next route (installed) | → Mastra server endpoint |
|---|---|
| `GET /api/images/:id` | `GET /images/:id` |

The controller surface is the rest of it — the workbench panels and
`use-agent-controller-chat` call all of these:

| Next route (installed) | → Mastra server endpoint |
|---|---|
| `/api/agent-controller/stream` | `/agent-controller/stream` (SSE) |
| `POST /api/agent-controller/approve` | `POST /agent-controller/approve` (per-tool approval) |
| `POST /api/agent-controller/answer` | `POST /agent-controller/answer` (`ask_user` reply) |
| `GET`/`DELETE /api/agent-controller/goal` | `GET`/`DELETE /agent-controller/goal` (read + dismiss; the agent *sets* goals via its own `setGoal` tool, not a web POST) |
| `GET /api/agent-controller/om` | `GET /agent-controller/om` (observational memory) |
| `GET /api/agent-controller/schedules` | `GET /agent-controller/schedules` |
| `GET /api/agent-controller/threads` | `GET /agent-controller/threads` |
| `GET /api/agent-controller/threads/search?q=` | `GET /agent-controller/threads/search?q=` |
| `GET`/`DELETE /api/agent-controller/threads/:id` | `GET`/`DELETE /agent-controller/threads/:id` |
| `GET /api/agent-controller/threads/:id/messages` | `GET /agent-controller/threads/:id/messages` |
| `GET /api/workspace/files` | `GET /workspace/files` |
| `GET /api/workspace/file?path=` | `GET /workspace/file?path=` |
| `/api/browser/screencast` | `/browser/screencast` (SSE frames) |

> A stock `mastra dev` server does **not** expose these — it serves Mastra's own
> `/api/agents/*` shape. The kit's `packages/server` registers every route above
> with `registerApiRoute()`; treat it as the reference implementation.

Then mount `<ChatSwitcher />` (the AgentController shell — sidebar │ chat │ workbench;
it is not a mode toggle — there is only one engine)
from `@/components/chat`. The chat shell also calls `toast()` — mount shadcn's
`<Toaster />` in your root layout if you want notifications.

### The side panel

`chat-panel` is a skin for docking the agent beside an app's own pages, the way a
browser's assistant side panel sits beside a website. The host decides where it
lives and how wide it is; the panel fills the box it is given.

```tsx
import { ChatPanel } from '@/components/chat-panel/chat-panel';

<ChatPanel
  title="Assistant"                                   // header title
  greeting={{ title: 'Hi Simone', description: 'Ask about your work.' }}
  suggestions={[{ label: 'Grants closing soon', prompt: 'Which grants close this month?' }]}
  placeholder="How can I help you today?"             // the default
  actions={<><FullScreenButton /><CloseButton /></>}   // your header buttons
/>
```

The header's History menu lists the same conversations as the full shell's
sidebar (`useThreads`), and New chat starts a fresh one. Tool approvals, `ask_user`
questions and submitted plans render through `components/chat/transcript.tsx`
(shipped in `chat-tool-views`), the same pieces `chat-minimal` uses, so the panel
can always answer what the agent is waiting on. Keep it mounted in a layout that
survives navigation and the conversation stays put across pages.

The composer is the kit's shared one (`chat-composer`, also used by the full shell):
attachments with previews, a microphone for dictation, and send. The mic uses the
browser's own speech recognition (Chrome, Edge, Safari 14.5+ including iOS) and is
simply not shown where that is missing. Attached images reach the model as image
parts (`tests/integration/attachments.test.ts`), and an image can be sent with no
text. The server accepts only inline `data:` URLs of images, PDFs and plain text, at
most 4 files of 5 MB each, and refuses an oversized body with a 413
(`routes/stream-body.ts` in `chat-server`). That route check runs after Mastra has
read the body, so a server on the internet also needs a body-size cap at its reverse
proxy (README, Deployment). The same goes for the Next.js app in front of it: the
browser posts to `chat-routes`' `/api/agent-controller/stream`, which reads the whole
body before forwarding it. The composer applies the same limits when a file is added
and says why it refused one, and when the server refuses a message the composer keeps
its text and attachments and the server's reason is shown. It ships no colours of its own:
`className` sets the root (for example `bg-sidebar` to match your sidebar), and
`--chat-panel-header-height` lines its header up with yours.

`onToolEnd` (on `ChatPanel`, `ChatSwitcher`, or `useAgentControllerChat({ onToolEnd })`)
is called each time the agent finishes a tool call, with the tool's name, its call id
and whether it reported an error. A host uses it to refresh its own page after the agent
changed something, e.g. `router.refresh()` once a write action ends.

Links in the agent's replies (`chat-markdown.tsx` in `chat-tool-views`, used by every
skin) skip Streamdown's "Open external link?" dialog. A link to one of your app's own
pages (a path such as `/grants/42`, or a URL on your origin) is a Next.js `<Link>` and
navigates in place; any other link opens in a new tab with `rel="noopener noreferrer"`.
`onNavigate` (on `ChatPanel`) is called when one of your pages is opened that way: a host
showing the panel in a sheet or dialog closes it there, e.g.
`<ChatPanel onNavigate={() => setSheetOpen(false)} />`.

### Fit it into your app

`<ChatSwitcher />` takes options, so a host app changes what it needs without
editing installed files (which a reinstall would overwrite). All are optional;
the defaults are the kit's own demo setup.

```tsx
<ChatSwitcher
  className="h-full"                       // root sizing; default h-dvh (whole screen)
  workbenchTabs={['memory', 'schedules']}  // default all five; [] removes the workbench
  suggestions={[{ label: 'Grants closing soon', prompt: 'Which grants close this month?' }]}
  greeting={{ title: 'Hi Simone', description: 'Ask about your work.' }}
  models={false}                           // hide the picker (server CHAT_MODEL), or pass a list
  webSearch={false}                        // hide the "Search the web" toggle
/>
```

| Prop | Default | What it changes |
|---|---|---|
| `className` | `h-dvh` | The shell's root. Inside a host layout pass the height it should take, e.g. `h-full`. |
| `workbenchTabs` | `['files','terminal','browser','memory','schedules']` | Which workbench tabs show, in that order. `[]` removes the workbench and its toggle. Drop `terminal`/`browser` when the server runs without a sandbox/browser (see the server switches below). |
| `suggestions` | the demo prompts | The empty-state pills: `{ label, prompt }[]`. `[]` shows none. |
| `greeting` | "What's on your mind today?" | The empty-state heading and the line under it. |
| `models` | the kit's Anthropic + OpenAI list | The composer's model picker: a `{ id, name, provider }[]` list (first one selected), or `false` to hide it so every turn runs on the server's `CHAT_MODEL`. The server only honours ids on its model allowlist. |
| `webSearch` | `true` | Show the composer's "Search the web" toggle. The server points the agent at Firecrawl when `FIRECRAWL_API_KEY` is set, otherwise at the workspace browser; hide the toggle when the server has neither. |

`WorkbenchPanel` takes the same `tabs` list if you mount it yourself.

### Users and auth

By default the routes forward with no identity and the server keeps **one shared
Session**. Two settings change that; neither changes anything when unset.

**1. `MASTRA_JWT_SECRET` — the same value on both sides.** On the Mastra server it
gates Studio, every `/api/*` route and all 16 contract routes behind a Bearer JWT
(`MastraJwtAuth`). In the web app (server-side env only, never `NEXT_PUBLIC_`)
`lib/mastra-proxy.ts` signs every forwarded request with an HS256 token that
expires after 5 minutes. A deployed server with the secret set refuses anything
that did not come through your proxy. This is all a single-user app needs: with no
user hook, the proxy signs every request as the one shared user.

**2. `configureChatKitProxy({ getUserId })` — optional, for more than one user.**
Call it once at startup from `instrumentation.ts`:

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { configureChatKitProxy } = await import('@/lib/mastra-proxy');
  const { getUserIdFromRequest } = await import('@/lib/auth'); // your auth library
  configureChatKitProxy({ getUserId: (request) => getUserIdFromRequest(request) });
}
```

`getUserId(request)` returns the signed-in user's id, or `null`. With it set, a
request with no user is answered **401 by the proxy**, and the user's id becomes the
token's `sub`, which the server maps to the request's resource id. Per-user
Sessions need the secret too: without it there is no trusted way to tell the server
who the user is.

**What is per user:** the Session and its threads (another user's thread id answers
404 on read, rename, delete and resume) and thread search. **Everything else is
shared by everyone on the server:** plan files, schedules, the workspace folder, the
browser and generated images.

**The proxy routes do not check a session themselves.** They are open to anyone who
can reach your app unless `getUserId` is set or your own middleware guards
`/api/agent-controller/*`, `/api/workspace/*`, `/api/browser/*` and `/api/images/*`.

The hook lives on `globalThis` because Next bundles `instrumentation.ts` and each
route handler separately; a module variable would not be shared between them. The
route handlers run on the Node.js runtime (the proxy uses `node:crypto`).

## Building / maintaining the registry

```bash
pnpm --filter @mastra-chat-kit/web build:registry
```

This runs `scripts/gen-registry.mjs` (which **parses the real imports** of the
shipped files so the manifest can't drift from the code) then `shadcn build`
(emits `public/r/*.json`). `public/r/` is gitignored — it's a build artifact,
regenerated on deploy (`vercel.json` runs `build:registry` before `next build`).

> **Gotcha:** local sibling refs in `registry.json` must be namespace-qualified
> (`@mastra-chat-kit/code-block`), not bare. A bare name resolves against the
> **default** shadcn registry (ui.shadcn.com) and 404s. The generator handles
> this; only genuine shadcn/ui primitives stay bare.
