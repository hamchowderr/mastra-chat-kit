import { expect, test } from '@playwright/test';

/**
 * Full chat flow, end-to-end and AIMock-backed: real browser → Next web →
 * Mastra server → AIMock fixtures (fixtures/chat.json), no LLM spend.
 *
 * Each test starts on a fresh page load, which mints a new thread. Semantic recall
 * still injects messages from earlier threads, so the fixtures match on
 * hasToolResult (current turn only), not turn counts. Message assertions are scoped to the conversation `log`
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

/**
 * The controller gates every tool behind approval, so a tool turn parks on a
 * Confirmation card until someone decides. Assert the card, approve, and let the
 * run finish — a run left parked leaks its pending tool call into the next test.
 */
async function approveTool(page: import('@playwright/test').Page, tool: string) {
  const card = convo(page)
    .getByRole('alert')
    .filter({ hasText: `Run ${tool}?` });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Approve' }).click();
}

test('gates getWeather behind approval, then answers from the tool', async ({ page }) => {
  await send(page, "What's the weather in Los Angeles?");
  // The tool call renders (the <Tool> element surfaces the tool name)...
  await expect(convo(page).getByRole('button', { name: /getWeather/ })).toBeVisible();
  await approveTool(page, 'getWeather');
  // ...and after approval the model's grounded follow-up answer streams in.
  await expect(convo(page).getByText(/los angeles looks clear/i)).toBeVisible();
});

test('reasons, calls searchKnowledge on approval, and answers', async ({ page }) => {
  await send(page, 'How do I use Mastra memory?');
  await expect(convo(page).getByRole('button', { name: /searchKnowledge/ })).toBeVisible();
  await approveTool(page, 'searchKnowledge');
  await expect(convo(page).getByText(/Overview: Mastra memory/)).toBeVisible();
});

test('saves the finished chat to the history sidebar', async ({ page }) => {
  await send(page, 'Hello');
  await expect(convo(page).getByText(/how can i help/i)).toBeVisible();
  // The finished conversation is persisted and now appears as an entry in the
  // left history rail, titled from its first turn (under AIMock the auto-title is
  // the assistant's greeting, which contains "how can I help"). `.first()`
  // tolerates other threads created earlier in the same run.
  await expect(
    page
      .getByRole('complementary')
      .getByRole('button', { name: /how can i help/i })
      .first(),
  ).toBeVisible();
});

// MUST stay last: the server keeps one Session for the whole run, and an
// "Always allow" grant lasts for that session, so any later test that uses a
// read tool would no longer see its approval card.
test('always allow read tools: the next read tool runs without asking', async ({ page }) => {
  await send(page, "What's the weather in Los Angeles?");
  const card = convo(page).getByRole('alert').filter({ hasText: 'Run getWeather?' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Always allow read tools' }).click();
  await expect(convo(page).getByText(/los angeles looks clear/i)).toBeVisible();

  // Same tool again: it runs and answers with no approval card this time.
  await send(page, "What's the weather in Los Angeles?");
  await expect(convo(page).getByText(/los angeles looks clear/i)).toHaveCount(2);
  await expect(convo(page).getByRole('alert').filter({ hasText: 'Run getWeather?' })).toHaveCount(
    0,
  );
});
