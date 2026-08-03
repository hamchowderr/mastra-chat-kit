/**
 * Does `chat-server` actually install into a BARE MASTRA PROJECT and compile?
 *
 * The existing registry smoke test scaffolds a Next app — it proves the web half.
 * Nothing proved the server half, and "the JSON has content" is not the same as
 * "a consumer can install it and it typechecks". This is that missing check.
 *
 * Deliberately NOT a Next app: a Mastra server is a plain TypeScript project with
 * no React, no Tailwind, no components/. If chat-server only installs into a Next
 * app, it is useless for its actual purpose.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(fileURLToPath(import.meta.url), '../..');
const PORT = Number(process.env.SERVER_SMOKE_PORT ?? 8947);
const WORK = join(tmpdir(), 'chat-server-smoke');
// Nest the project one level below the temp root. shadcn walks UP from the
// project looking for a root and will scandir the whole of %TEMP% otherwise,
// which on Windows hits system dirs like WinSAT and dies with EPERM. The
// existing registry-smoke.mjs nests for the same reason.
const PROJECT = join(WORK, 'consumer');
const started = Date.now();
const log = (m) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s] ${m}`);

// MUST be async. execFileSync blocks the event loop, so the registry server below
// cannot answer while a child is running — shadcn then fails with a Headers
// Timeout Error that looks like a broken registry but is the harness's fault.
const quoteArg = (a) => (/[\s"^&|<>]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const run = (cmd, args, opts = {}) =>
  new Promise((res) => {
    const win = process.platform === 'win32';
    const base = { windowsHide: true, ...opts };
    const p = win
      ? spawn([cmd, ...args].map(quoteArg).join(' '), { ...base, shell: true })
      : spawn(cmd, args, base);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => res({ code, out }));
  });

function die(msg, detail) {
  console.error(`\n✗ ${msg}`);
  if (detail) console.error(detail.split('\n').slice(-30).join('\n'));
  process.exit(1);
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(PROJECT, { recursive: true });

// Build first — public/r is gitignored, so on a fresh checkout (CI) it does not
// exist yet, and serving an empty directory would 404 the install.
log('building registry');
{
  const gen = await run('node', ['scripts/gen-registry.mjs'], { cwd: WEB });
  if (gen.code !== 0) die('gen-registry.mjs failed', gen.out);
  const build = await run('npx', ['--yes', 'shadcn@latest', 'build'], { cwd: WEB });
  if (build.code !== 0) die('shadcn build failed', build.out);
}
if (!existsSync(join(WEB, 'public/r/chat-server.json'))) {
  die('public/r/chat-server.json missing after build — nothing to serve');
}

// Serve the built registry.
const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(await readFile(join(WEB, 'public', rel)));
  } catch {
    res.writeHead(404);
    res.end('nope');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
log(`serving public/ on :${PORT}`);

// A bare Mastra-style TS project: package.json, tsconfig, and the minimum
// components.json shadcn needs to resolve a registry. No React, no Tailwind.
log('scaffolding a bare Mastra project (no React, no Next)');
writeFileSync(
  join(PROJECT, 'package.json'),
  JSON.stringify(
    { name: 'consumer-server', version: '0.0.0', private: true, type: 'module' },
    null,
    2,
  ),
);
writeFileSync(
  join(PROJECT, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
      include: ['**/*.ts'],
      exclude: ['node_modules'],
    },
    null,
    2,
  ),
);
writeFileSync(
  join(PROJECT, 'components.json'),
  JSON.stringify(
    {
      $schema: 'https://ui.shadcn.com/schema.json',
      style: 'new-york',
      rsc: false,
      tsx: true,
      tailwind: { config: '', css: '', baseColor: 'neutral', cssVariables: true },
      aliases: { components: '@/components', utils: '@/lib/utils' },
      registries: { '@mastra-chat-kit': `http://127.0.0.1:${PORT}/r/{name}.json` },
    },
    null,
    2,
  ),
);

// typescript MUST be a local dep: bare 'npx tsc' resolves to an unrelated decoy
// package on npm that prints 'This is not the tsc command you are looking for'
// and exits 0 — a typecheck that never runs and silently passes.
log('installing @mastra/core + typescript');
{
  const { code, out } = await run(
    'npm',
    ['install', '--silent', '@mastra/core@1.52.1', 'typescript@5.9.3'],
    { cwd: PROJECT },
  );
  if (code !== 0) die('npm install @mastra/core failed', out);
}

log('shadcn add @mastra-chat-kit/chat-server');
{
  const { code, out } = await run(
    'npx',
    ['--yes', 'shadcn@latest', 'add', '@mastra-chat-kit/chat-server', '--yes'],
    {
      cwd: PROJECT,
    },
  );
  if (code !== 0) die('install failed', out);
}

// shadcn resolves a target against the consumer's OWN layout: a project with a
// src/ directory gets src/mastra/..., one without gets mastra/... . Both are
// correct. What must hold is that routes/ and lib/ keep their relative positions,
// because the route modules import ../lib/thread-utils.
const REL = [
  'mastra/routes/types.ts',
  'mastra/routes/threads.ts',
  'mastra/routes/controller.ts',
  'mastra/routes/workspace.ts',
  'mastra/lib/thread-utils.ts',
];
const BASE = existsSync(join(PROJECT, 'src', 'mastra')) ? 'src/' : '';
const EXPECT = REL.map((f) => `${BASE}${f}`);
const missing = EXPECT.filter((f) => !existsSync(join(PROJECT, f)));
if (missing.length) die(`files did not land at their targets:\n  ${missing.join('\n  ')}`);
log(`files OK — ${EXPECT.length} landed at the expected targets`);

// The whole point of the seam: an installed route module must NOT drag in this
// repo's wiring. If any shipped file imports agents/, tools/ or lib/agent-controller,
// the consumer's build breaks on files that were never shipped.
const forbidden = [];
for (const f of EXPECT) {
  const src = readFileSync(join(PROJECT, f), 'utf8');
  for (const m of src.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
    const spec = m[1];
    if (
      /agents\/|tools\/|agent-controller'|lib\/memory|lib\/dolt|lib\/env|lib\/workspace/.test(spec)
    ) {
      forbidden.push(`${f} imports ${spec}`);
    }
  }
}
if (forbidden.length)
  die(`shipped files reach back into this repo's wiring:\n  ${forbidden.join('\n  ')}`);
log("no shipped file imports this repo's agents/tools/storage wiring");

log('typechecking the consumer');
{
  const { code, out } = await run('npx', ['tsc', '--noEmit'], { cwd: PROJECT });
  if (code !== 0) {
    const errs = out.split('\n').filter((l) => l.includes('error TS'));
    die(`consumer does not typecheck — ${errs.length} error(s)`, errs.join('\n'));
  }
}

server.close();
console.log('\n✓ chat-server installs into a bare Mastra project and typechecks');
