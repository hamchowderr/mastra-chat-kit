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
| `chat` | block | The canonical shell — conversation, composer, history sidebar, tool renderers, **plus the controller sidebar and the 4-tab workbench** (browser, files, memory, schedules). **This is what you install.** |
| `chat-engine` | lib | Swappable transport + controller client (`lib/transports`, `lib/agent-controller`). |
| `chat-routes` | block | Same-origin Next route handlers + `mastra-proxy.ts` that forward to a Mastra server — chat, threads, the full `agent-controller/*` surface, workspace, and browser screencast. Pulled in automatically by `chat`. |
| `code-block` | component | AI Elements code block **+ our SSR hydration fix** (mount-gated Shiki). |
| `image` | component | AI Elements image with `uint8Array` optional (renders from base64). |
| `context` | component | AI Elements context/usage with `Partial<LanguageModelUsage>`. |
| `tool` | component | AI Elements tool display, rewired to our local `code-block`. |
| `agent` | component | AI Elements agent/tool roster with a strict-TS fit — a `Tool` `description` may be a function, so it's narrowed before render. |

Everything else (`message`, `conversation`, `reasoning`, `prompt-input`, …) is
pulled straight from Vercel's registry at install time, and shadcn/ui primitives
(`button`, `dialog`, …) from the default shadcn registry.

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
| `base-nova` (Base UI) | 14 | all in upstream Vercel AI Elements |

Vercel's elements are authored against Radix; on a Base UI project the transform
leaves them with Base UI primitives they weren't written for (`openDelay` /
`closeDelay` props that no longer exist, `BaseUIEvent` vs `Event` handler
signatures). That is why Radix is the supported base.

In every configuration measured, **0 errors landed in this kit's own files**
(`components/chat`, `lib/agent-controller`, `lib/transports`, `app/api`).

> For the record, the two upstream elements that import `@radix-ui/…`
> (`reasoning`, `chain-of-thought`) are *not* the problem — they use only
> `@radix-ui/react-use-controllable-state`, a base-agnostic hook that Vercel's
> registry items already declare in their own `dependencies`.

In the consumer project's `components.json`, add the namespace:

```json
{
  "registries": {
    "@mastra-chat-kit": "https://mastra-chat-kit.vercel.app/r/{name}.json"
  }
}
```

Then install the whole chat layer:

```bash
npx shadcn@latest add @mastra-chat-kit/chat
```

shadcn resolves the dependency graph automatically: our 5 vendored components +
`chat-engine` + `chat-routes` from `@mastra-chat-kit`, the other AI Elements from
Vercel, and the shadcn/ui primitives from the default registry. (Individual items
also install, e.g. `npx shadcn@latest add @mastra-chat-kit/code-block`.)

Installing `chat` lays down **82 files** — measured by a real install into a
fresh `init --base radix` project (shadcn CLI 4.16.0, 2026-07-29):

| | Files | From |
|---|---|---|
| `components/chat/*.tsx` | 12 | this registry |
| `app/api/**/route.ts` | 20 | this registry |
| `lib/agent-controller`, `lib/transports`, `mastra-proxy` | 4 | this registry |
| `components/ai-elements/*.tsx` | 23 | 5 ours + 18 from Vercel |
| `components/ui/*.tsx` | 23 | the default shadcn registry |
| **Total** | **82** | |

> Upstream counts drift as Vercel and shadcn change; `bd mastra-chat-kit-7zt`
> turns this measurement into a scheduled check. (An earlier hand-count of 61
> predates shipping the controller half.)

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
| `GET /api/threads` † | `GET /threads` |
| `GET /api/threads/search?q=` † | `GET /threads/search?q=` |
| `GET /api/threads/:id/messages` † | `GET /threads/:id/messages` |
| `GET`/`DELETE /api/threads/:id` † | `GET`/`DELETE /threads/:id` |
| `POST /api/threads/:id/title` † | `POST /threads/:id/title` |
| `GET /api/images/:id` | `GET /images/:id` |

> † **Installed but unused.** These five built the removed Agent-mode sidebar; the
> shipped UI reads `/api/agent-controller/threads*` instead. They are also scoped to
> the server's `LOCAL_RESOURCE`, not the controller's `CHAT_RESOURCE_ID`, so they
> return an empty list as-is. Kept for now as a generic Memory thread-CRUD starting
> point — whether to drop or repurpose them is `bd mastra-chat-kit-e70`.

The controller surface is what the shell actually drives — the workbench panels and
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
