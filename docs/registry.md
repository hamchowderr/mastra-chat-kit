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
| `chat-tool-views` | component | Shared renderers turning real tool output into elements (sources, generated images, plan, goal card, `ask_user`). Used by **every** skin. |
| `chat-engine` | lib | The engine: Agent Controller SSE client, transcript reducer, and the data hooks that own every `/api/*` call. UI-free — imports only React. |
| `chat-routes` | block | Same-origin Next route handlers + `mastra-proxy.ts` that forward to a Mastra server — chat, threads, the full `agent-controller/*` surface, workspace, and browser screencast. Pulled in automatically by `chat`. |
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
```

Both drive the **same** `AgentController` session — same threads, same tool
approvals, same subagents, same workspace. They differ only in layout.

**To author a third skin:** render over `useAgentControllerChat()` from
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
| `base-nova` (Base UI) | 13 | see the breakdown below |

Vercel's elements are authored against Radix; on a Base UI project the transform
leaves them with Base UI primitives they weren't written for. That is why Radix
is the supported base.

#### The Base UI failures, measured

Reproduce with `node packages/web/scripts/registry-smoke.mjs --base base --report`
— it installs onto Base UI and prints the errors grouped by file instead of
asserting. Measured 2026-08-02, shadcn CLI 4.16.0 / Next 16.2.6:

| File | Errors | Ours? | Cause |
|---|---|---|---|
| `prompt-input.tsx` | 7 | upstream | 4 × `BaseUIEvent<…>` vs `Event` handler signatures, 3 × `openDelay`/`closeDelay` |
| `attachments.tsx` | 3 | upstream | `openDelay`/`closeDelay` on PreviewCard |
| `context.tsx` | 1 | **ours** | `openDelay` on PreviewCard |
| `inline-citation.tsx` | 1 | upstream | `openDelay` on PreviewCard |
| `plan.tsx` | 1 | upstream | `ButtonProps` mismatch |

Two root causes account for 12 of the 13: **`openDelay`/`closeDelay` do not exist
on Base UI's PreviewCard** (8), and **Base UI wraps handler events in
`BaseUIEvent<…>`** (4). The last is a `ButtonProps` shape mismatch in `plan`.

Note the correction: **one of the failures is in a file we ship.** `context.tsx`
is one of the five vendored elements, so that one is ours to fix rather than
upstream's — earlier notes here said all of them were upstream's. Tracked in
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
