import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request, baseURL }) => { await request.post(`${baseURL}/__reset`); });

test('look-out discussions keep context, support follow-ups, and reopen from either surface', async ({ page, request }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('button', { name: 'Run AI review' }).click();
  const lookout = page.locator('[data-testid^="ai/lookout/"]').first();
  await expect(lookout).toContainText('Check authorization');
  await page.getByRole('button', { name: 'Close AI chat' }).click();
  await lookout.getByRole('button', { name: 'Discuss look-out' }).click();
  await expect(lookout.getByRole('textbox', { name: 'Look-out question', exact: true })).toHaveValue('Can you explain this look-out in simpler terms, with an example?');
  await lookout.screenshot({ path: testInfo.outputPath('lookout-question.png') });
  const outgoing = page.waitForRequest(req => req.url().endsWith('/api/ai/chat') && req.method() === 'POST');
  await lookout.getByRole('button', { name: 'Send look-out question' }).click();
  expect((await outgoing).postDataJSON()).toHaveProperty('lookoutId');
  await expect(lookout.locator('.ai-message.assistant')).toHaveCount(1);
  await lookout.getByRole('textbox', { name: 'Look-out question', exact: true }).fill('How could I verify this concern?');
  await lookout.screenshot({ path: testInfo.outputPath('lookout-conversation.png') });
  await lookout.getByRole('button', { name: 'Send look-out question' }).click();
  await expect(lookout.locator('.ai-message.assistant')).toHaveCount(2);
  await lookout.getByRole('button', { name: 'Close discussion' }).click();
  await expect(lookout.locator('.ai-message')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('tab', { name: /Findings/ }).click();
  const rail = page.getByTestId('ai-rail');
  await rail.getByRole('button', { name: 'Continue discussion' }).click();
  await expect(rail.locator('.ai-lookout-discussion .ai-message.assistant')).toHaveCount(2);
  await expect(rail.locator('.ai-lookout-discussion')).toContainText('How could I verify this concern?');
  await rail.getByRole('button', { name: 'Close discussion' }).click();
  await expect(rail.locator('.ai-lookout-discussion .ai-message')).toHaveCount(0);
  const state = await request.get('/api/ai').then(response => response.json());
  expect(state.conversation).toEqual([]);
  expect(Object.keys(state.threads)).toHaveLength(1);
  expect(Object.keys(state.threads)[0]).toMatch(/^lookout:/);
});
