/**
 * Capture README screenshots from the RUNNING web app (default http://localhost:3000).
 *
 * Two groups of shots:
 *   1. STATIC  — the empty chat and the /events map. No model calls.
 *   2. LIVE    — real AgentController sessions driven to a specific UI state (a pending tool
 *                approval, a subagent delegation, a task checklist, a populated
 *                workbench). These DO drive the agent, so run the server against
 *                AIMock for deterministic, zero-spend output.
 *
 * Run it:
 *   pnpm --filter @mastra-chat-kit/server dev:mock          # AIMock on :4010
 *   USE_AIMOCK=true pnpm --filter @mastra-chat-kit/server dev
 *   pnpm --filter @mastra-chat-kit/web build && pnpm --filter @mastra-chat-kit/web start
 *   node packages/web/scripts/screenshot.mjs
 *
 * Serve the web as a PRODUCTION build, not `next dev` — Turbopack's HMR socket can
 * abort React hydration and leave the page non-interactive.
 *
 * The LIVE prompts below are matched VERBATIM by the AIMock fixtures in
 * packages/server/fixtures/chat.json. Changing a prompt string here without
 * updating the fixture will fall through to the catch-all and capture a generic
 * reply instead of the state you wanted.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const BASE = process.env.SHOT_BASE_URL ?? 'http://localhost:3000';
const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs');
const COMPOSER = 'textarea[data-slot="input-group-control"]';

const wrote = [];
const failed = [];

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  // 1440x900. Don't shrink the height: a pending approval card sits below a
  // "Steps" reasoning block, and a shorter frame pushes it out of view so the
  // capture waits on text it can never see.
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = await context.newPage();

async function shot(name) {
  const out = path.join(docs, name);
  await page.screenshot({ path: out });
  wrote.push(name);
  console.log('  ✓ wrote', name);
}

/**
 * Start a genuinely isolated session.
 *
 * "New chat" alone is NOT enough. A scenario that parks at an un-approved gate
 * leaves its controller run open on the live SSE, and the next message can land on
 * that same session — which produced a capture showing weather output under a
 * "use the code subagent" prompt. Reloading drops the SSE so each scenario gets
 * a clean controller.
 */
async function newChat() {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page
    .getByText(/on your mind|Ask anything/i)
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /new chat/i }).click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await page.locator(COMPOSER).waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * Guard against cross-scenario bleed: the transcript must not mention a tool or
 * phrase that belongs to a different scenario. Returns true if the capture is
 * trustworthy.
 */
async function verify(forbidden) {
  if (!forbidden) return true;
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const word of forbidden) {
    if (body.includes(word.toLowerCase())) {
      console.log(`    ! bleed detected — transcript contains "${word}"`);
      return false;
    }
  }
  return true;
}

/** Type a prompt and submit it. */
async function send(prompt) {
  const box = page.locator(COMPOSER);
  await box.waitFor({ state: 'visible', timeout: 10_000 });
  await box.click();
  await box.fill(prompt);
  await page.keyboard.press('Enter');
}

/** Wait for text to appear, but never hard-fail the whole run on one scenario. */
async function settle(pattern, timeout = 45_000) {
  try {
    await page.getByText(pattern).first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

// ── 1. STATIC ────────────────────────────────────────────────────────────────
console.log('static shots');
for (const s of [
  { url: '/', out: 'empty-state.png', waitText: /on your mind/i },
  { url: '/events', out: 'events.png', waitText: /AgentController events/i },
]) {
  await page.goto(`${BASE}${s.url}`, { waitUntil: 'domcontentloaded' });
  await page
    .getByText(s.waitText)
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
  await shot(s.out);
}

// ── 2. LIVE ──────────────────────────────────────────────────────────────────
// Each entry drives one AgentController capability to the state worth showing.
// ORDER MATTERS — this sequence is empirically the one that works; reordering it
// broke all three captures. Two reasons:
//   1. The fixtures match on `turnIndex` (assistant messages in the request), and
//      Mastra's semantic recall pulls earlier threads into later ones, so history
//      accumulated by earlier scenarios can push a later one past turn 0 and
//      silently resolve the "final answer" fixture instead of the tool call.
//   2. A scenario left parked at an un-approved gate keeps its controller run open;
//      the next message can queue as a follow-up on that session rather than
//      starting clean.
// Always run against a freshly-wiped packages/server/mastra.db.
const SCENARIOS = [
  {
    out: 'approval.png',
    prompt: "What's the weather in Los Angeles?",
    // Stop AT the pending approval — the whole point is the un-answered card.
    waitFor: /Approve/i,
    approve: false,
  },
  {
    out: 'subagent.png',
    prompt: 'Use the code subagent to create hello.txt',
    waitFor: /Approve/i,
    approve: true,
    afterApprove: /hello\.txt|code/i,
    forbidden: ['getWeather', 'Los Angeles'],
  },
  {
    out: 'tasks.png',
    prompt: 'Build a small counter script: create it, then run it.',
    waitFor: /Approve/i,
    approve: true,
    afterApprove: /counter|step/i,
    forbidden: ['getWeather', 'Los Angeles', 'hello.txt'],
  },
];

console.log('live shots (AIMock-backed)');
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page
  .getByText(/on your mind/i)
  .first()
  .waitFor({ timeout: 20_000 })
  .catch(() => {});
await page.waitForTimeout(1500);

for (const s of SCENARIOS) {
  console.log(`  → ${s.out}: "${s.prompt}"`);
  try {
    await newChat();
    await send(s.prompt);
    const reached = await settle(s.waitFor);
    if (!reached) {
      console.log(`    ! never reached ${s.waitFor} — skipping (fixture drift?)`);
      failed.push(s.out);
      continue;
    }
    if (s.approve) {
      await page
        .getByRole('button', { name: /^Approve$/i })
        .first()
        .click({ timeout: 10_000 });
      if (s.afterApprove) await settle(s.afterApprove, 45_000);
      await page.waitForTimeout(2000);
    } else {
      await page.waitForTimeout(800);
    }
    if (!(await verify(s.forbidden))) {
      failed.push(s.out);
      continue;
    }
    await shot(s.out);
  } catch (err) {
    console.log(`    ! ${s.out} failed: ${err.message.split('\n')[0]}`);
    failed.push(s.out);
  }
}

// ── 3. HERO — a finished session with the workbench open ──────────────────────
// The workbench only has anything to show AFTER the agent has touched the
// workspace, so this runs the file-writing scenario first, then opens the panel.
console.log('hero shot');
try {
  await newChat();
  await send('Use the code subagent to create hello.txt');
  if (await settle(/Approve/i)) {
    await page
      .getByRole('button', { name: /^Approve$/i })
      .first()
      .click({ timeout: 10_000 });
    await settle(/hello\.txt|code/i, 45_000);
  }
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Show workbench' }).click({ timeout: 10_000 });
  await page.getByText('Schedules').first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await shot('workbench.png');
} catch (err) {
  console.log(`    ! workbench.png failed: ${err.message.split('\n')[0]}`);
  failed.push('workbench.png');
}

await browser.close();

console.log(`\nwrote ${wrote.length}: ${wrote.join(', ')}`);
if (failed.length) {
  console.log(`FAILED ${failed.length}: ${failed.join(', ')}`);
  process.exitCode = 1;
}
