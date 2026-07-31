/**
 * Registry install smoke test — proves a consumer can actually install this kit.
 *
 *   node packages/web/scripts/registry-smoke.mjs
 *
 * It stands up a throwaway project the way a real consumer would, installs the
 * chat layer into it, and asserts the result typechecks and builds:
 *
 *   1. build the registry (gen-registry.mjs + `shadcn build` -> public/r)
 *   2. serve public/ over http, so `@mastra-chat-kit/{name}` resolves
 *   3. `shadcn init --base radix`, then pin iconLibrary to lucide
 *   4. `shadcn add @mastra-chat-kit/chat`
 *   5. assert the expected files landed
 *   6. `tsc --noEmit` -> 0 errors, then `next build` -> exit 0
 *
 * Why it serves LOCALLY rather than hitting the hosted registry: this has to
 * catch a broken manifest before it is deployed, and public/r is gitignored so
 * it only exists as a build artifact. Pass --hosted <url> to additionally check
 * a deployed registry answers (that is the other half of bd mastra-chat-kit-7zt).
 *
 * Two exposures this is designed to catch:
 *   - UPSTREAM: the chat item declares full-URL registryDependencies against
 *     ai-sdk.dev. If Vercel renames an item or has an outage, new installs break.
 *     On install failure this probes every upstream URL and names the one that
 *     404'd, rather than reporting a generic "install failed".
 *   - OURS: a manifest that references files nobody ships, or a deploy that
 *     silently 404s every consumer.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(fileURLToPath(import.meta.url), '../..');
const PORT = Number(process.env.SMOKE_PORT ?? 8931);
const WORK = join(tmpdir(), `mck-smoke-${process.pid}`);
const PROJECT = join(WORK, 'consumer');
const hostedArg = process.argv.indexOf('--hosted');
const HOSTED = hostedArg > -1 ? process.argv[hostedArg + 1] : null;

// What a correct install must produce. These counts are the contract; if the
// registry legitimately grows, update them here in the same commit.
const EXPECT = {
  'components/chat': 10,
  'components/ai-elements': 5, // OUR vendored ones; upstream adds more on top
  'app/api': 14, // route.ts files
};

let server;
const started = Date.now();

function log(msg) {
  const s = ((Date.now() - started) / 1000).toFixed(0).padStart(3);
  console.log(`[${s}s] ${msg}`);
}

const quoteArg = (a) => (/[\s"^&|<>]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const win = process.platform === 'win32';
    // On Windows npx/tsc/next are .cmd shims, and Node refuses to spawn those
    // directly (CVE-2024-27980) — they need a shell. But passing an args ARRAY
    // alongside shell:true is deprecated (DEP0190), so build one pre-quoted
    // command string instead. POSIX takes the normal argv form.
    const base = {
      cwd: opts.cwd ?? WEB,
      windowsHide: true,
      env: { ...process.env, ...opts.env },
    };
    const p = win
      ? spawn([cmd, ...args].map(quoteArg).join(' '), { ...base, shell: true })
      : spawn(cmd, args, base);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => res({ code, out }));
  });
}

async function die(msg, detail) {
  console.error(`\n✗ ${msg}`);
  if (detail) console.error(detail.split('\n').slice(-40).join('\n'));
  server?.close();
  rmSync(WORK, { recursive: true, force: true });
  process.exit(1);
}

/** Name the upstream dependency that broke, instead of "install failed". */
async function diagnoseUpstream() {
  const manifest = JSON.parse(readFileSync(join(WEB, 'registry.json'), 'utf8'));
  const urls = [
    ...new Set(
      manifest.items.flatMap((i) => i.registryDependencies.filter((d) => d.startsWith('http'))),
    ),
  ];
  console.error(`\nProbing ${urls.length} upstream registryDependencies:`);
  const broken = [];
  for (const url of urls) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) {
        broken.push(`${r.status} ${url}`);
        console.error(`  ✗ ${r.status} ${url}`);
      }
    } catch (err) {
      broken.push(`ERR ${url}`);
      console.error(`  ✗ ERR ${url} — ${err.message}`);
    }
  }
  if (!broken.length) console.error('  all upstream URLs answer; the break is on our side');
  return broken;
}

// ── 1. Build the registry ────────────────────────────────────────────────────
log('building registry');
{
  const { code, out } = await run('node', ['scripts/gen-registry.mjs']);
  if (code !== 0) await die('gen-registry.mjs failed (manifest is inconsistent)', out);
  const build = await run('npx', ['--yes', 'shadcn@latest', 'build']);
  if (build.code !== 0) await die('`shadcn build` failed', build.out);
}
if (!existsSync(join(WEB, 'public/r/chat.json'))) {
  await die('public/r/chat.json missing after build — nothing to serve');
}

// ── 2. Serve it ──────────────────────────────────────────────────────────────
await new Promise((res) => {
  server = createServer(async (req, rq) => {
    try {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const body = await readFile(join(WEB, 'public', rel));
      rq.writeHead(200, { 'content-type': 'application/json' });
      rq.end(body);
    } catch {
      rq.writeHead(404);
      rq.end('not found');
    }
  }).listen(PORT, '127.0.0.1', res);
});
log(`serving public/ on :${PORT}`);

if (HOSTED) {
  const r = await fetch(`${HOSTED.replace(/\/$/, '')}/r/chat.json`).catch(() => null);
  if (!r?.ok)
    await die(`hosted registry did not answer: ${HOSTED} (${r?.status ?? 'network error'})`);
  log(`hosted registry OK: ${HOSTED}`);
}

// ── 3. Scaffold a consumer at the SUPPORTED base ─────────────────────────────
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
log('scaffolding a consumer project (shadcn init --base radix)');
{
  const { code, out } = await run(
    'npx',
    [
      '--yes',
      'shadcn@latest',
      'init',
      '--template',
      'next',
      '--base',
      'radix',
      '--preset',
      'maia',
      '--name',
      'consumer',
      '--yes',
      '--no-monorepo',
      '--cwd',
      WORK,
    ],
    { cwd: WORK },
  );
  if (code !== 0) await die('shadcn init failed', out);
}
if (!existsSync(join(PROJECT, 'components.json'))) await die('init produced no components.json');

// Pin the icon library BEFORE installing. On hugeicons, shadcn's own
// ui/spinner.tsx does not typecheck (reproduced in a bare shadcn project), and
// every component here imports lucide-react anyway.
{
  const f = join(PROJECT, 'components.json');
  const j = JSON.parse(readFileSync(f, 'utf8'));
  j.iconLibrary = 'lucide';
  j.registries = { '@mastra-chat-kit': `http://127.0.0.1:${PORT}/r/{name}.json` };
  writeFileSync(f, JSON.stringify(j, null, 2));
  log(`consumer ready — style=${j.style}, iconLibrary=${j.iconLibrary}`);
}

// ── 4. Install ───────────────────────────────────────────────────────────────
log('installing @mastra-chat-kit/chat');
{
  const { code, out } = await run(
    'npx',
    ['--yes', 'shadcn@latest', 'add', '@mastra-chat-kit/chat', '--yes'],
    { cwd: PROJECT },
  );
  if (code !== 0) {
    const broken = await diagnoseUpstream();
    await die(
      broken.length
        ? `install failed — ${broken.length} upstream dependency/ies unreachable:\n  ${broken.join('\n  ')}`
        : 'install failed (upstream is fine — check the manifest)',
      out,
    );
  }
}

// The SECOND skin, installed into the SAME project. This is the real proof that
// skins are independent: chat-minimal must not depend on `chat`, both must resolve
// the shared engine + tool-views to the same files, and the two must coexist and
// compile together (the tsc + next build below cover both). See bd 23d.
log('installing @mastra-chat-kit/chat-minimal (second skin, same project)');
{
  const { code, out } = await run(
    'npx',
    ['--yes', 'shadcn@latest', 'add', '@mastra-chat-kit/chat-minimal', '--yes'],
    { cwd: PROJECT },
  );
  if (code !== 0) await die('chat-minimal install failed', out);
}

// ── 5. Assert the files landed ───────────────────────────────────────────────
// A plain walk rather than fs.globSync — that is still experimental on Node 22,
// which is what CI runs.
const { readdirSync } = await import('node:fs');
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const counts = {
  'components/chat': walk(join(PROJECT, 'components/chat')).filter((f) => f.endsWith('.tsx'))
    .length,
  'app/api': walk(join(PROJECT, 'app/api')).filter((f) => f.endsWith('route.ts')).length,
};
const OURS = ['agent', 'code-block', 'context', 'image', 'tool'];
const missingElements = OURS.filter(
  (n) => !existsSync(join(PROJECT, `components/ai-elements/${n}.tsx`)),
);

const problems = [];
if (counts['components/chat'] !== EXPECT['components/chat']) {
  problems.push(
    `components/chat: got ${counts['components/chat']}, expected ${EXPECT['components/chat']}`,
  );
}
if (counts['app/api'] !== EXPECT['app/api']) {
  problems.push(`app/api route handlers: got ${counts['app/api']}, expected ${EXPECT['app/api']}`);
}
if (missingElements.length)
  problems.push(`vendored elements missing: ${missingElements.join(', ')}`);
if (!existsSync(join(PROJECT, 'lib/mastra-proxy.ts'))) problems.push('lib/mastra-proxy.ts missing');
// The second skin, and the shared renderers it resolves to via chat-tool-views —
// if that dependency is ever dropped, chat-minimal installs without tool-views and
// fails to compile, so assert the file rather than just the skin.
if (!existsSync(join(PROJECT, 'components/chat-minimal/minimal-chat.tsx')))
  problems.push('components/chat-minimal/minimal-chat.tsx missing (second skin)');
if (!existsSync(join(PROJECT, 'components/chat/tool-views.tsx')))
  problems.push('components/chat/tool-views.tsx missing (shared by both skins)');
if (problems.length) await die(`installed tree is wrong:\n  ${problems.join('\n  ')}`);
log(
  `files OK — ${counts['components/chat']} chat components, ${counts['app/api']} routes, 5 vendored elements`,
);

// ── 6. It has to actually compile ────────────────────────────────────────────
log('typechecking the consumer');
{
  const { code, out } = await run('npx', ['--yes', 'tsc', '--noEmit'], { cwd: PROJECT });
  if (code !== 0) {
    const errs = out.split('\n').filter((l) => l.includes('error TS'));
    const ours = errs.filter((l) => /^(components\/chat|lib\/|app\/api)/.test(l));
    await die(
      `consumer does not typecheck — ${errs.length} error(s), ${ours.length} in files this kit ships`,
      errs.join('\n'),
    );
  }
}
log('building the consumer');
{
  const { code, out } = await run('npx', ['--yes', 'next', 'build'], { cwd: PROJECT });
  if (code !== 0) await die('consumer `next build` failed', out);
}

server.close();
rmSync(WORK, { recursive: true, force: true });
console.log('\n✓ registry smoke test passed — a clean install typechecks and builds');
