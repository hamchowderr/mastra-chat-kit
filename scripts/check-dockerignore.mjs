// Fails CI if .dockerignore stops excluding the things that must never reach an
// image layer (bd mastra-chat-kit-azh).
//
// The bug this exists for: the server image's build context moved from
// packages/server up to the repo root, which silently invalidated the anchoring of
// every ignore rule. Docker matches with Go filepath.Match, NOT gitignore
// semantics — a bare `node_modules` or `.env` matches ONLY at the context root, so
// the host's packages/server/node_modules was copied in (clobbering the container's
// own pnpm install with symlinks pointing at C:/Users/...) and packages/server/.env
// was baked into a layer. `**/` matches zero or more directories, so it covers the
// nested case AND the root one.
//
// This is deliberately a TEXTUAL lint of the rules, not a simulation of Docker's
// matcher. Re-implementing filepath.Match would repeat the exact mistake being
// guarded against here, and a wrong simulator that passes is worse than no
// simulator at all. What actually PROVES an image is clean is
// .github/workflows/container.yml, which builds the real image and inspects it with
// scripts/verify-container-image.mjs. This check is the fast half: it runs in
// milliseconds on every CI run so the obvious regression is caught before anyone
// waits ~15 minutes for a build.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, '.dockerignore');

// Each pattern must be present verbatim, with the reason it matters — a bare
// message like "missing **/.env" doesn't tell the next person what breaks.
const REQUIRED = [
  [
    '**/node_modules',
    "the host's packages/*/node_modules would be copied over the container's own install",
  ],
  ['**/.env', 'packages/server/.env — real API keys — would be baked into an image layer'],
  ['**/.env.local', 'a local override holding credentials would be baked into an image layer'],
  ['**/.env.*.local', 'a per-environment local override holding credentials would be baked in'],
  ['**/*.db', 'local libSQL databases would ship as image content'],
  ['**/.mastra', "the host's build output would be copied over the one the image builds"],
];

// A rule naming one of these is only correct with a `**/` prefix (or as an
// explicitly anchored path such as `packages/web`). Matched on the basename.
const SENSITIVE = [/^\.env($|\.)/, /^node_modules$/, /^.*\.db(-shm|-wal)?$/, /^\.mastra$/];

const raw = readFileSync(FILE, 'utf8');
const lines = raw
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const errors = [];

// (1) every required exclusion is present
const present = new Set(lines);
for (const [pattern, why] of REQUIRED) {
  if (!present.has(pattern)) {
    errors.push(`missing required rule "${pattern}" — without it, ${why}`);
  }
}

// (2) no sensitive rule left un-prefixed. Catches someone "tidying" `**/.env`
// back to `.env`, which reads as equivalent and is not.
for (const line of lines) {
  const rule = line.replace(/^!/, ''); // negations follow the same anchoring
  if (rule.startsWith('**/')) continue;
  const base = rule.split('/').pop();
  if (!SENSITIVE.some((re) => re.test(base))) continue;
  // An anchored path (a/b) targets one known location on purpose; a bare name does not.
  if (rule.includes('/')) continue;
  errors.push(
    `rule "${line}" has no "**/" prefix, so Docker matches it ONLY at the context root — ` +
      `nested copies (e.g. packages/server/${base}) would be sent to the daemon`,
  );
}

if (errors.length) {
  console.error(`\n❌ .dockerignore no longer protects the image (${errors.length}):\n`);
  for (const e of [...new Set(errors)].sort()) console.error(`  • ${e}`);
  console.error(
    '\nAdd the rule with a "**/" prefix. Docker is not gitignore: "**/" matches zero or\n' +
      'more directories, so one rule covers both the context root and every nested copy.\n',
  );
  process.exit(1);
}

console.log(
  `[check-dockerignore] ${REQUIRED.length} required exclusions present, no un-prefixed sensitive rules`,
);
