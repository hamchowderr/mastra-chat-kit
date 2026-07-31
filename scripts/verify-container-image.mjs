/**
 * Proves a built server image is safe to ship and actually runs (bd mastra-chat-kit-azh).
 *
 *   docker build -f packages/server/Dockerfile -t mastra-chat-kit-server:ci .
 *   node scripts/verify-container-image.mjs mastra-chat-kit-server:ci
 *
 * This is the check that MATTERS. scripts/check-dockerignore.mjs lints the ignore
 * rules, but linting rules is reasoning about Docker's behaviour — and reasoning
 * about it is precisely what failed: `.dockerignore` uses Go filepath.Match, not
 * gitignore semantics, so when the build context moved to the repo root every bare
 * rule quietly stopped matching nested paths. The result was an image containing
 * the host's packages/server/node_modules (Windows symlinks that resolve to nothing
 * on Linux, which broke `mastra build`) and packages/server/.env — real API keys —
 * baked into a layer. Nothing detected either; the branch was pushed unbuildable.
 *
 * So: build the real image, then look inside it.
 *
 *   Phase 1 (contents)  — what must NOT be there, and what must.
 *   Phase 2 (behaviour) — boot it and require the server to actually answer.
 *
 * Failures accumulate and are reported together, so one run tells you everything
 * that is wrong rather than one thing at a time.
 *
 * Runs on placeholder credentials only. Booting the server never calls a model, so
 * no real key is needed and none should ever be passed to this script.
 */

import { spawn } from 'node:child_process';

const IMAGE = process.argv[2];
const HOST_PORT = Number(process.env.VERIFY_PORT ?? 41111);
const CONTAINER = `mck-verify-${process.pid}`;
const HEALTH_TIMEOUT_MS = 120_000;

if (!IMAGE) {
  console.error('[verify-image] usage: node scripts/verify-container-image.mjs <image-tag>');
  process.exit(1);
}

const started = Date.now();
const errors = [];

function log(msg) {
  const s = ((Date.now() - started) / 1000).toFixed(0).padStart(3);
  console.log(`[verify-image] [${s}s] ${msg}`);
}

/** Resolves to {code, stdout, stderr} — never rejects, so callers assert instead of catching. */
function docker(args, { timeoutMs = 180_000 } = {}) {
  return new Promise((res) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      res({ code: -1, stdout, stderr: String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      res({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/** Runs a shell snippet inside a throwaway container and returns its stdout. */
async function inImage(script) {
  const r = await docker(['run', '--rm', '--entrypoint', 'sh', IMAGE, '-c', script]);
  if (r.code !== 0) {
    errors.push(
      `could not inspect the image (docker exited ${r.code}): ${r.stderr || '(no stderr)'}`,
    );
    return null;
  }
  return r.stdout;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Phase 1: contents ────────────────────────────────────────────────────────
//
// Each probe prints matching paths and nothing else, so "" means clean. `find` is
// scoped past node_modules — dependencies legitimately ship .env fixtures and test
// databases of their own, and flagging those would train everyone to ignore this.
//
// Two things every probe needs:
//   - `|| true`. The image runs as uid 1001, so `find /` hits directories it may
//     not read and exits 1 even with stderr silenced. Without this, a permission
//     warning is indistinguishable from "docker could not inspect the image".
//   - pruning /proc, /sys and the Playwright browser bundle. Walking those adds
//     over a minute and can contain nothing we ship.
const PRUNE = `-path /proc -prune -o -path /sys -prune -o -path /ms-playwright -prune -o`;

async function checkContents() {
  log(`inspecting ${IMAGE}`);

  const envFiles = await inImage(
    `find / ${PRUNE} -name '.env' -not -path '*/node_modules/*' -print 2>/dev/null || true`,
  );
  if (envFiles) {
    for (const f of envFiles.split('\n').filter(Boolean)) {
      // Deliberately does NOT print the contents — the point is that it is there.
      errors.push(
        `SECRET LEAK: ${f} is baked into the image. A .dockerignore rule is not matching it.`,
      );
    }
  }

  // Both slash styles: pnpm writes the symlink using whatever separator the host
  // used, and a Windows host can produce either.
  const hostLinks = await inImage(
    `{ find /app -type l -lname '*C:/Users*' -print 2>/dev/null; find /app -type l -lname '*C:\\\\Users*' -print 2>/dev/null; } || true`,
  );
  if (hostLinks) {
    for (const f of hostLinks.split('\n').filter(Boolean)) {
      errors.push(
        `${f} is a symlink into a Windows host path — the host's node_modules was copied ` +
          `over the container's own install, and it resolves to nothing on Linux`,
      );
    }
  }

  const dbFiles = await inImage(
    `find /app -name '*.db' -not -path '*/node_modules/*' -print 2>/dev/null || true`,
  );
  if (dbFiles) {
    for (const f of dbFiles.split('\n').filter(Boolean)) {
      errors.push(
        `${f} is a local database copied from the host — it should be a volume, not image content`,
      );
    }
  }

  // Present-and-correct assertions. A build can "succeed" and produce nothing
  // useful; without these the image would only fail at run time, in production.
  const musts = [
    ['/app/.mastra/output/index.mjs', 'the server entrypoint — `mastra build` produced no output'],
    [
      '/app/.mastra/output/studio/index.html',
      'the bundled Studio UI — `mastra build --studio` regressed',
    ],
  ];
  for (const [path, why] of musts) {
    const found = await inImage(`test -e '${path}' && echo yes || echo no`);
    if (found === 'no') errors.push(`missing ${path} — ${why}`);
  }

  // Chromium lands here via a `find`-resolved playwright-core CLI, because npm
  // hoists that package and pnpm leaves it in the virtual store. If that
  // resolution breaks again, browser tools fail at first use, not at build.
  const browsers = await inImage(`ls /ms-playwright 2>/dev/null | head -5`);
  if (!browsers) {
    errors.push(
      '/ms-playwright is empty — Chromium was not provisioned, so every browser tool call will fail',
    );
  }

  const uid = await inImage('id -u');
  if (uid && uid !== '1001') {
    errors.push(`image runs as uid ${uid}, expected 1001 (the non-root \`mastra\` user)`);
  }

  log(`contents checked — ${errors.length} problem(s) so far`);
}

// ─── Phase 2: behaviour ───────────────────────────────────────────────────────
async function checkBehaviour() {
  log('starting the container');
  const run = await docker([
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-p',
    `${HOST_PORT}:4111`,
    '-e',
    'TURSO_DATABASE_URL=file:/app/data/mastra.db',
    '-e',
    'APP_SECRET=verify-app-secret-at-least-thirty-two-chars',
    '-e',
    'ANTHROPIC_API_KEY=sk-ant-placeholder-not-a-real-key',
    IMAGE,
  ]);
  if (run.code !== 0) {
    errors.push(`the container would not start: ${run.stderr || '(no stderr)'}`);
    return;
  }

  // Poll health rather than sleeping a fixed amount. `exited` short-circuits so a
  // crashloop reports in seconds instead of burning the whole timeout.
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let status = '';
  while (Date.now() < deadline) {
    const s = await docker([
      'inspect',
      '--format',
      '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}',
      CONTAINER,
    ]);
    status = s.stdout;
    if (status.includes('healthy') && !status.includes('unhealthy')) break;
    if (status.startsWith('exited')) {
      const logs = await docker(['logs', '--tail', '40', CONTAINER]);
      errors.push(
        `the container exited instead of starting. Last logs:\n${logs.stdout}\n${logs.stderr}`,
      );
      return;
    }
    await sleep(2000);
  }
  if (!status.includes('healthy') || status.includes('unhealthy')) {
    const logs = await docker(['logs', '--tail', '40', CONTAINER]);
    errors.push(
      `the container never became healthy within ${HEALTH_TIMEOUT_MS / 1000}s (last status: "${status}").\n${logs.stdout}\n${logs.stderr}`,
    );
    return;
  }
  log(`container is healthy on :${HOST_PORT}`);

  // Fetched from the host, so this also proves the port is actually published and
  // the server is bound to something other than loopback-inside-the-container.
  const base = `http://127.0.0.1:${HOST_PORT}`;
  const probes = [
    ['/health', (r) => r.ok, 'the health endpoint did not return 2xx'],
    ['/', (r) => r.ok, 'the bundled Studio UI did not return 2xx'],
  ];
  for (const [path, ok, why] of probes) {
    try {
      const res = await fetch(`${base}${path}`);
      if (!ok(res)) errors.push(`GET ${path} -> ${res.status}: ${why}`);
    } catch (e) {
      errors.push(`GET ${path} failed: ${e.message}`);
    }
  }

  try {
    const res = await fetch(`${base}/api/agents`);
    const body = await res.json();
    if (!body?.chat) {
      errors.push(
        `/api/agents did not include the "chat" agent (got: ${Object.keys(body ?? {}).join(', ') || 'nothing'})`,
      );
    }
  } catch (e) {
    errors.push(`GET /api/agents failed: ${e.message}`);
  }

  log('endpoints checked');
}

try {
  await checkContents();
  await checkBehaviour();
} finally {
  // Always clean up, including on an unexpected throw — a leftover container holds
  // the port and makes the NEXT run fail for an unrelated reason.
  await docker(['rm', '-f', CONTAINER], { timeoutMs: 60_000 });
}

if (errors.length) {
  console.error(`\n❌ the built image is not shippable (${errors.length}):\n`);
  for (const e of [...new Set(errors)].sort()) console.error(`  • ${e}`);
  console.error(
    '\nIf a file is present that should not be, add the rule to .dockerignore with a\n' +
      '"**/" prefix — Docker is not gitignore, and a bare pattern matches only the\n' +
      'context root. If something expected is missing, the build stage produced it in a\n' +
      'different place; check packages/server/Dockerfile rather than hardcoding a path.\n',
  );
  process.exit(1);
}

console.log(
  `\n[verify-image] ${IMAGE} is clean: no secrets, no host files, boots healthy, endpoints answer.\n`,
);
