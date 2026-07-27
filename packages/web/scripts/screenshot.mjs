/**
 * Capture README screenshots from the RUNNING web app (default http://localhost:3000).
 *
 *   pnpm dev            # in one terminal (server + web)
 *   node packages/web/scripts/screenshot.mjs
 *
 * Writes docs/screenshot.png (chat) and docs/events.png (the harness event map).
 * Uses a real (headed) Chromium so Next's client render hydrates fully — a headless
 * dev server can abort hydration under Turbopack HMR (see the e2e note in the README).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const BASE = process.env.SHOT_BASE_URL ?? 'http://localhost:3000';
const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs');

const shots = [
  { url: '/', out: 'screenshot.png', waitText: /on your mind|Harness|Chat/i },
  { url: '/events', out: 'events.png', waitText: /Harness events/i },
];

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = await context.newPage();

for (const s of shots) {
  await page.goto(`${BASE}${s.url}`, { waitUntil: 'domcontentloaded' });
  // Wait for the client render to hydrate (a known heading/text appears).
  await page
    .getByText(s.waitText)
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
  const out = path.join(docs, s.out);
  await page.screenshot({ path: out });
  console.log('wrote', out);
}

// Workbench (right rail) open on the Files tab — the sidebar │ chat │ workbench shell.
// networkidle (not just domcontentloaded) so the client fully hydrates before we click.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page
  .getByText(/on your mind/i)
  .first()
  .waitFor({ timeout: 15_000 });
await page.getByRole('button', { name: 'Show workbench' }).click({ timeout: 5000 });
// Confirm the panel opened (a workbench tab appears) before capturing.
await page.getByText('Schedules').first().waitFor({ timeout: 5000 });
await page.waitForTimeout(1000);
const wbOut = path.join(docs, 'workbench.png');
await page.screenshot({ path: wbOut });
console.log('wrote', wbOut);

await browser.close();
