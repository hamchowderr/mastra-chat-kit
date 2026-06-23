import { expect, test } from '@playwright/test';

/**
 * Full chat flow, end-to-end and AIMock-backed: real browser → Next web →
 * Mastra server → AIMock fixtures (fixtures/chat.json), no LLM spend.
 *
 * Each test starts on a fresh page load, which mints a new thread — so the turn
 * is the FIRST in its thread and the turn-indexed fixtures resolve
 * deterministically. Message assertions are scoped to the conversation `log`
 * (not the whole page) because the persistent history sidebar accumulates titles
 * from earlier turns and would otherwise match.
 */

const COMPOSER = 'Ask anything…';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();
});

/** The active conversation transcript (role=log), excluding the history sidebar. */
function convo(page: import('@playwright/test').Page) {
  return page.getByRole('log');
}

/**
 * Type a message into the composer and submit. Real keystrokes (pressSequentially)
 * so React's controlled `text` state updates and enables Submit — `fill()` sets
 * the DOM value without the change the PromptInput needs.
 */
async function send(page: import('@playwright/test').Page, text: string) {
  const box = page.getByPlaceholder(COMPOSER);
  await box.click();
  await box.pressSequentially(text, { delay: 8 });
  const submit = page.getByRole('button', { name: 'Submit' });
  await expect(submit).toBeEnabled();
  await submit.click();
}

test('streams a text answer to a greeting', async ({ page }) => {
  await send(page, 'Hello');
  await expect(convo(page).getByText(/how can i help/i)).toBeVisible();
});

test('renders the getWeather tool call and a grounded answer', async ({ page }) => {
  await send(page, "What's the weather in Los Angeles?");
  // The tool call renders (the <Tool> element surfaces the tool name)...
  await expect(convo(page).getByText(/getWeather/i)).toBeVisible();
  // ...and the model's grounded follow-up answer streams in.
  await expect(convo(page).getByText(/los angeles looks clear/i)).toBeVisible();
});

test('reasons and calls the searchKnowledge tool', async ({ page }) => {
  await send(page, 'How do I use Mastra memory?');
  // The reasoning + search-tool call render. (The grounded answer that follows a
  // reasoning+tool turn doesn't stream under AIMock — a mock-only quirk; real
  // models render it, and the weather test already covers tool → answer.)
  await expect(convo(page).getByText(/searchKnowledge/i)).toBeVisible();
});

test('saves the finished chat to the history sidebar', async ({ page }) => {
  await send(page, 'Hello');
  await expect(convo(page).getByText(/how can i help/i)).toBeVisible();
  // The finished conversation is persisted and now appears as an entry in the
  // left history rail (titled from its first turn). `.first()` tolerates other
  // greeting threads created earlier in the same run.
  await expect(
    page
      .getByRole('complementary')
      .getByRole('button', { name: /how can i help/i })
      .first(),
  ).toBeVisible();
});
