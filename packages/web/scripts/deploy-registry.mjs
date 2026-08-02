#!/usr/bin/env node
// Deploy the shadcn registry as a standalone static site.
//
// The registry is 11 JSON files plus a landing page — no framework, no build at
// serve time. Keeping it on its own deployment means the registry cannot be taken
// down by anything that happens to the demo app, which is exactly how it broke
// before (the app's Vercel project was deleted and every `shadcn add` started
// 404ing while the docs still advertised the URL).
//
// This script is the ONLY supported way to publish it. Deploying by hand from a
// scratch directory works once and then nobody can reproduce it.
//
//   node scripts/deploy-registry.mjs            # build, stage, deploy to production
//   node scripts/deploy-registry.mjs --dry-run  # build + stage, print the tree, don't deploy
//
// Requires the Vercel CLI to be logged in (`npx vercel login`).

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WEB = process.cwd(); // packages/web
const SITE = join(WEB, 'registry-site'); // index.html + vercel.json (committed)
const BUILT = join(WEB, 'public', 'r'); // registry JSON (generated, gitignored)

// Stage OUTSIDE the workspace, in the OS temp dir. Vercel walks up from the
// deploy directory looking for a package.json to detect the framework; staging
// anywhere under packages/web makes it find the Next.js one and fail the build
// with "No Next.js version detected". There is deliberately no package.json in
// the staged site — it is 12 static files.
const OUT = join(tmpdir(), 'mastra-chat-kit-registry-deploy');

const PROJECT = 'mastra-chat-kit-registry';
const SCOPE = 'otaku-solutions';
const DRY = process.argv.includes('--dry-run');

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });

function step(msg) {
  console.log(`\n▸ ${msg}`);
}

// 1. Always rebuild — deploying a stale public/r is the failure mode this whole
//    script exists to prevent.
step('building the registry');
run('pnpm', ['build:registry'], { cwd: WEB });

if (!existsSync(BUILT) || readdirSync(BUILT).length === 0) {
  console.error(`\n✖ ${BUILT} is empty after build:registry — nothing to deploy.`);
  process.exit(1);
}

// 2. Stage: the committed site shell + the freshly built item JSON under /r.
step('staging');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SITE, OUT, { recursive: true });
cpSync(BUILT, join(OUT, 'r'), { recursive: true });

const items = readdirSync(join(OUT, 'r')).filter((f) => f.endsWith('.json'));
console.log(`  ${items.length} registry files + ${readdirSync(SITE).join(', ')}`);

if (DRY) {
  console.log(`\n✓ dry run — staged at ${OUT}, not deployed`);
  process.exit(0);
}

// 3. Link explicitly by project NAME. Without this, Vercel infers the project
//    from the directory name (`.registry-deploy`) and silently creates a new one.
step(`linking to ${SCOPE}/${PROJECT}`);
run('npx', ['vercel', 'link', '--yes', '--project', PROJECT, '--scope', SCOPE, '--cwd', OUT]);

step('deploying to production');
run('npx', ['vercel', 'deploy', '--prod', '--yes', '--scope', SCOPE, '--cwd', OUT]);

console.log('\n✓ deployed — verify with:');
console.log(
  '    node scripts/registry-smoke.mjs --hosted https://mastra-chat-kit-registry.vercel.app',
);
