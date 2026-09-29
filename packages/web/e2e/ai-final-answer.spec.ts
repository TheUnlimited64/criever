import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request, baseURL }) => { await request.post(`${baseURL}/__reset`); });

test('an inline answer omits harness progress and persists only the final answer', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  await page.getByTestId('code/row/new/3/gutter').click();
  await page.getByRole('button', { name: 'Ask AI privately' }).click();
  await page.getByRole('textbox', { name: 'Private question', exact: true }).fill('Show final answer only');
  await page.getByRole('button', { name: 'Send private question' }).click();

  const answer = page.locator('[data-testid^="ai/thread/"] .ai-message.assistant .mdPreview');
  await expect(answer).toHaveText('Yes. Full IRIs must use exact IRI lookup.');
  await page.reload();
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  await expect(answer).toHaveText('Yes. Full IRIs must use exact IRI lookup.');
});

test('a general answer also omits harness progress', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByLabel('General question').fill('Show final answer only');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();

  await expect(page.getByTestId('ai/general-messages').locator('.ai-message.assistant .mdPreview'))
    .toHaveText('Yes. Full IRIs must use exact IRI lookup.');
});

test('an unmarked harness response is rejected rather than displayed or persisted', async ({ page, request, baseURL }) => {
  await page.goto('/');
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByLabel('General question').fill('Show unmarked response');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('AI did not provide a final answer');
  const state = await request.get(`${baseURL}/api/ai`).then(response => response.json());
  expect(state.conversation).toEqual([]);
});
