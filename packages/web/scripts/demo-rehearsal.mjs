/**
 * Rehearse the live demo (docs/demo.md) end to end against the RUNNING stack, the way
 * the presenter clicks through it, and screenshot each beat.
 *
 * Run it after the setup in docs/demo.md (AIMock + server with USE_AIMOCK + a
 * production web build), on a freshly reset server (`pnpm demo:reset`):
 *
 *   node packages/web/scripts/demo-rehearsal.mjs            # headless
 *   HEADED=1 node packages/web/scripts/demo-rehearsal.mjs   # watch it
 *   CHROMIUM_PATH=/path/to/chrome …                         # use another Chromium
 *
 * Every step waits for the text the audience should see and fails loudly if it never
 * shows, so a green run means the demo as documented works on this machine. It leaves
 * the server in the post-demo state: reset again before going on stage.
 *
 * The prompts are the ones in docs/demo.md and packages/server/fixtures/chat.json;
 * change them in all three places or a step falls through to the catch-all reply.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3000';
const OUT =
  process.env.DEMO_SHOTS ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../demo-rehearsal');
const COMPOSER = 'textarea[data-slot="input-group-control"]';
const CATCH_ALL = /reference assistant \(running on AIMock/;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: !process.env.HEADED,
  // A Chromium other than the one this Playwright version downloads, if needed.
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
).newPage();
const log = page.getByRole('log');

let shots = 0;
async function shot(name) {
  shots += 1;
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${String(shots).padStart(2, '0')}-${name}.png`) });
}

/** Wait for text to be visible anywhere on the page. */
async function see(text, timeout = 30_000) {
  await page.getByText(text).first().waitFor({ state: 'visible', timeout });
}

async function click(name, timeout = 30_000) {
  await page.getByRole('button', { name }).first().click({ timeout });
}

async function send(prompt) {
  const box = page.locator(COMPOSER);
  await box.waitFor({ state: 'visible' });
  await box.click();
  await box.fill(prompt);
  await page.keyboard.press('Enter');
}

async function newChat() {
  await click(/new chat/i);
  await page.waitForTimeout(500);
}

/** Open the workbench (if closed) and select a tab. */
async function tab(name) {
  const show = page.getByRole('button', { name: 'Show workbench' });
  if (await show.isVisible().catch(() => false)) await show.click();
  await page.getByRole('tab', { name }).click();
}

async function step(title, fn) {
  process.stdout.write(`• ${title} … `);
  try {
    await fn();
    if (await log.getByText(CATCH_ALL).count()) throw new Error('fell through to the catch-all');
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    await page.screenshot({ path: path.join(OUT, `FAILED-${title.replace(/\W+/g, '-')}.png`) });
    await browser.close();
    throw err;
  }
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await see(/on your mind/i);
// Let hydration finish: typing into the pre-hydration textarea is silently lost.
await page.waitForTimeout(1500);

await step('0. weather — the approval gate', async () => {
  await send("What's the weather in Los Angeles?");
  await see('Run getWeather?');
  await shot('weather-approval');
  await click(/^Approve$/);
  await see(/Los Angeles looks clear/);
  await shot('weather-done');
});

await step('1. research — sources, always-allow', async () => {
  await newChat();
  await send('Research what the AgentController does and cite your sources.');
  await see('Run searchKnowledge?');
  await click(/Always allow read tools/);
  await see(/Overview: AgentController tool approvals/);
  await see(/Tool calls with side effects park at an approval gate/);
  await shot('research-sources');
});

await step('2. plan mode — approve, then the live checklist', async () => {
  await newChat();
  await click(/^Plan$/);
  await send('Plan a weather briefing for Tokyo, Paris and New York, then carry it out.');
  await see('Run mastra_workspace_write_file?');
  await click(/^Approve$/);
  await see('Weather briefing: Tokyo, Paris, New York');
  await see('Approve plan');
  await shot('plan-card');
  await click(/Approve plan/);
  await see(/switched to Chat mode/);
  await see(/Pack light for Tokyo/, 60_000);
  await shot('plan-checklist-done');
});

await step('3. code subagent — Files + Terminal', async () => {
  await newChat();
  await send('Have the code subagent build a FizzBuzz script and run it.');
  await see('Run subagent?');
  await click(/^Approve$/);
  await see('Run mastra_workspace_execute_command?', 60_000);
  await shot('code-subagent');
  await click(/^Approve$/);
  await see(/Verified — the output is in the/, 60_000);
  await tab('Files');
  await see('fizzbuzz.js');
  await shot('code-files');
  await tab('Terminal');
  await see('FizzBuzz');
  await shot('code-terminal');
});

await step('4. ask_user — the answer steers the reply', async () => {
  await newChat();
  await send("Draft a one-line announcement for tonight's meetup.");
  await see('What tone should the announcement have?');
  await shot('ask-user');
  await click(/^Playful$/);
  await see(/one very brave demo/);
  await shot('ask-user-answered');
});

await step('5. image generation — a real PNG', async () => {
  await newChat();
  await send('Generate an image of a sunset over the mountains.');
  await see('Run generateImage?');
  await click(/^Approve$/);
  await page.getByRole('img', { name: /sunset over layered purple mountains/i }).waitFor();
  const size = await page
    .getByRole('img', { name: /sunset over layered purple mountains/i })
    .evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  if (size[0] !== 256) throw new Error(`image did not decode (naturalWidth ${size[0]})`);
  await shot('image');
});

await step('6. schedules — a recurring job', async () => {
  await newChat();
  await send('Every weekday at 9am, remind me to post my standup update.');
  await see('Run start_schedule?');
  await click(/^Approve$/);
  await see(/runs at 09:00 Monday to Friday/);
  await tab('Schedules');
  await see('0 9 * * 1-5');
  await shot('schedules');
});

await browser.close();
console.log(`\nall steps passed — ${shots} screenshots in ${OUT}`);
