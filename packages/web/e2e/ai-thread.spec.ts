import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request, baseURL }) => { await request.post(`${baseURL}/__reset`); });

test('inline questions read as review conversation instead of diff code on desktop and phone', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  await page.getByTestId('code/row/new/3/gutter').click();
  await page.getByRole('button', { name: 'Ask AI privately' }).click();
  await page.getByRole('textbox', { name: 'Private question', exact: true }).fill('Explain this line');
  await page.getByRole('button', { name: 'Send private question' }).click();

  const thread = page.locator('[data-testid^="ai/thread/"]').first();
  await expect(thread.locator('.ai-message.assistant')).toContainText('Fixture answer');
  const answer = thread.locator('.ai-message.assistant .mdPreview');
  expect(await answer.evaluate(element => getComputedStyle(element).fontFamily)).toContain('IBM Plex Sans');
  await thread.screenshot({ path: testInfo.outputPath('thread-desktop.png') });

  await page.setViewportSize({ width: 375, height: 800 });
  await thread.getByRole('textbox', { name: 'Follow-up question' }).fill('Render markdown as a follow-up');
  await thread.getByRole('button', { name: 'Send follow-up' }).click();
  await expect(thread.locator('.ai-message.assistant')).toHaveCount(2);
  await thread.getByRole('button', { name: 'Send follow-up' }).scrollIntoViewIfNeeded();
  const box = await thread.boundingBox();
  expect(box).not.toBeNull();
  if (box) expect(box.x + box.width).toBeLessThanOrEqual(375);
  await thread.screenshot({ path: testInfo.outputPath('thread-phone.png') });
});
