# template-mastra-base — Build Spec

You (the AI coding agent) are completing this Mastra base template. The starting state is a clean `npx create-mastra@latest` scaffold with the weather example. Your job is to remove the example, layer in this template's conventions, and verify everything works.

## Read these spec files in order

1. **`01-context.md`** — Why this template exists, what's already decided, and which decisions you don't get to relitigate.
2. **`02-architecture.md`** — Final file layout, dependency list, env vars, component map.
3. **`03-files.md`** — Specifications for every file you'll create or edit, with code targets and acceptance criteria.
4. **`04-build-order.md`** — Strict order of operations. Don't deviate; later files depend on earlier ones working.
5. **`05-verification.md`** — How to test that what you built actually works, including the live smoke test.
6. **`06-known-gotchas.md`** — Pitfalls discovered during scoping. Read before debugging anything weird.

## Your operating mode

- **Stay in scope.** Don't add features, refactor scaffolded files beyond what's specified, or "improve" anything. The owner has made specific decisions and is depending on those decisions being respected.
- **Use Mastra's primitives.** This template's earlier draft reinvented several wheels (custom logger, custom scorer harness, custom Sentry integration). Those decisions were corrected — the spec uses `PinoLogger`, `@mastra/core/evals`, `Observability` exporters etc. directly. If you find yourself writing infrastructure that already exists in `@mastra/*`, stop and use the Mastra version.
- **Verify as you go.** Don't write all 15 files then run everything at once. Build one component, verify it, then move on. The build order in `04-build-order.md` includes verification checkpoints — hit them.
- **Ask before installing packages.** The dependency list in `02-architecture.md` is final. If you think a package is missing, say so before running `npm install <new-thing>`.
- **Ask before editing the boot sequence.** The order of imports in `src/mastra/index.ts` is load-bearing — env validation must crash before any LLM client is constructed. Don't reorder without flagging.
- **Use real env values for the live smoke test.** The owner will provide them. Stub values pass Zod but fail at agent runtime.

## Owner context

The owner runs a consulting practice that builds Mastra agents and resells the work to clients. This template is base infrastructure — it will be forked into category templates (RAG, voice, chat, NCA Toolkit) and then forked again per client. Code quality, predictability, and Mastra-idiom-correctness all matter more than cleverness or one-off optimizations. Treat this as **library code that strangers will fork**, not as "my one-off project."

The owner's stack: TypeScript / Next.js / Supabase / Vercel / n8n / Make / VAPI / LiveKit. Default to that ecosystem when making implementation choices.

## Reporting

After completing each phase in `04-build-order.md`, write a short summary in `SPEC/PROGRESS.md` (create it if needed). Format:

```
## Phase N: <name>
- Status: complete | blocked | skipped
- Files touched: <list>
- Verification: <pass | fail | n/a>
- Notes: <anything the owner should know — including violations of the spec you had to make and why>
```

If you get stuck, write the blocker into `PROGRESS.md` and stop. Don't paper over with workarounds.
