import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request, baseURL }) => { await request.post(`${baseURL}/__reset`); });

test('a reply never erases a second unsent general question', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  let release = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ai/chat', async route => { await blocked; await route.continue(); });
  await page.getByLabel('General question').fill('First question');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  await page.getByLabel('General question').fill('Second unsent question');
  release();
  await expect(page.getByTestId('ai/general-messages').locator('.ai-message.assistant')).toContainText('Fixture answer');
  await expect(page.getByLabel('General question')).toHaveValue('Second unsent question');
});

test('an inline reply never erases the next unsent follow-up', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  await page.getByTestId('code/row/new/3/gutter').click();
  await page.getByRole('button', { name: 'Ask AI privately' }).click();
  await page.getByRole('textbox', { name: 'Private question', exact: true }).fill('Explain this line');
  await page.getByRole('button', { name: 'Send private question' }).click();
  const thread = page.locator('[data-testid^="ai/thread/"]').first();
  await expect(thread.locator('.ai-message.assistant')).toHaveCount(1);
  let release = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ai/chat', async route => { await blocked; await route.continue(); });
  await thread.getByRole('textbox', { name: 'Follow-up question' }).fill('First follow-up');
  await thread.getByRole('button', { name: 'Send follow-up' }).click();
  await thread.getByRole('textbox', { name: 'Follow-up question' }).fill('Second unsent follow-up');
  release();
  await expect(thread.locator('.ai-message.assistant')).toHaveCount(2);
  await expect(thread.getByRole('textbox', { name: 'Follow-up question' })).toHaveValue('Second unsent follow-up');
});
