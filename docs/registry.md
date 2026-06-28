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
| `chat` | block | The canonical shell — conversation, composer, history sidebar, tool renderers, Agent/Harness modes. **This is what you install.** |
| `chat-engine` | lib | Swappable transport + harness client (`lib/transports`, `lib/harness`). |
| `code-block` | component | AI Elements code block **+ our SSR hydration fix** (mount-gated Shiki). |
| `image` | component | AI Elements image with `uint8Array` optional (renders from base64). |
| `context` | component | AI Elements context/usage with `Partial<LanguageModelUsage>`. |
| `tool` | component | AI Elements tool display, rewired to our local `code-block`. |

Everything else (`message`, `conversation`, `reasoning`, `prompt-input`, …) is
pulled straight from Vercel's registry at install time, and shadcn/ui primitives
(`button`, `dialog`, …) from the default shadcn registry.

### Why only 4 components are vendored

Vercel AI Elements is consumed shadcn-style (source copied into your repo). We
keep all of it tracking upstream **except** three files we had to patch, plus
`tool` (its file is unchanged — we only repoint its dependency at our patched
`code-block`):

- **`code-block`** — real SSR bug: a module-level Shiki cache warms on the server
  but is cold on each fresh client, so server HTML ≠ client's first render →
  React hydration mismatch. We gate highlighting on mount.
- **`image`** — `uint8Array` made optional; the element renders from `base64`.
- **`context`** — `usage` relaxed to `Partial<…>`; it reads only flat fields.

These are tracked in `bd mastra-chat-kit-k5f` to upstream to Vercel; once merged
we drop the overrides and depend 100% on upstream.

## Consuming the registry

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

shadcn resolves the dependency graph automatically: our 4 vendored components +
`chat-engine` from `@mastra-chat-kit`, the other AI Elements from Vercel, and the
shadcn/ui primitives from the default registry. (Individual items also install,
e.g. `npx shadcn@latest add @mastra-chat-kit/code-block`.)

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
