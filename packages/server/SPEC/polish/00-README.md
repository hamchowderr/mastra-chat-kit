# Polish Spec — Final Verification & Publish

The base template build is functionally complete (12 phases done, 11/12 automated tests passing). This polish pass closes the remaining gaps and validates the template is actually usable as a template by external callers.

## Read these files in order

1. **`00-README.md`** (this file) — Operating instructions for the polish pass
2. **`01-manual-studio-test.md`** — Walk through Mastra Studio manually to verify the live UX (covers verification Test 4 from the original SPEC)
3. **`02-github-publish.md`** — Push the repo to GitHub, configure CI secrets, verify CI runs green
4. **`03-template-provisioning-test.md`** — The most important test: provision a NEW project from this template via `npx create-mastra --template`. If this fails, the whole template strategy fails.
5. **`04-completeness-scorer-fix.md`** — Investigate and fix the borderline `completeness` score (0.364 vs 0.3 floor). Either calibrate properly or replace with a scorer that's meaningful for structured-extraction agents.
6. **`05-image-size-decision.md`** — Document the Docker image size trade-off in README so anyone forking this template understands why it's 676MB.

## Operating mode for this pass

- **Stop and ask if you find a real bug.** This polish phase is about *validating what was built*, not *building more*. If something doesn't work, surface it before fixing.
- **Update `SPEC/PROGRESS.md`** with a `## Polish Phase N` entry after each polish step, same format as before.
- **Don't introduce new dependencies.** If you think you need one, ask first.
- **Don't refactor working code.** Touch only what these specs explicitly call for.
- **Time budget**: this should take 60–90 minutes total. If you're 2x over budget on any step, stop and report.

## Order of operations

The polish steps build on each other:

```
01 (manual Studio test)  →  validates locally before publishing
02 (GitHub publish)      →  required before provisioning test can run
03 (provisioning test)   →  validates the actual product
04 (completeness fix)    →  CAN happen any time; orthogonal
05 (image size docs)     →  doc-only; do last
```

Steps 01, 02, 03 are gates: each must pass before the next. Step 04 can happen in parallel — do it whenever you want a break from the publishing flow. Step 05 is just documentation.

## Reporting

After all 5 polish steps complete, write a final entry in `PROGRESS.md`:

```
## Polish complete
- Status: complete | blocked
- All 5 polish steps: <list with pass/fail>
- Outstanding issues: <if any>
- Recommended next action: <e.g. "ready to start child templates" or "fix X first">
```

If anything fails, stop at that step and write a blocker entry. Don't push forward.
