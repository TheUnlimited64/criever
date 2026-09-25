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

test('dark private question opens as an annotation without a colored edge', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  await page.getByTestId('code/row/new/3/gutter').click();
  await page.getByRole('button', { name: 'Ask AI privately' }).click();

  const composer = page.locator('.line-composer .ai-question');
  await expect(composer).toBeVisible();
  await composer.screenshot({ path: testInfo.outputPath('question-dark-desktop.png') });
  await page.screenshot({ path: testInfo.outputPath('line-question-dark-desktop.png') });
  expect(await composer.evaluate(element => getComputedStyle(element).borderLeftWidth)).toBe('0px');
  expect(await composer.evaluate(element => getComputedStyle(element).fontFamily)).toContain('IBM Plex Sans');
  await page.setViewportSize({ width: 768, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('line-question-dark-tablet.png') });
  const tabletBounds = await composer.locator('textarea').boundingBox();
  expect(tabletBounds).not.toBeNull();
  if (tabletBounds) expect(tabletBounds.x + tabletBounds.width).toBeLessThanOrEqual(768);
  const tabletActions = await composer.getByRole('button', { name: 'Send private question' }).boundingBox();
  expect(tabletActions).not.toBeNull();
  if (tabletActions) expect(tabletActions.x + tabletActions.width).toBeLessThanOrEqual(768);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.screenshot({ path: testInfo.outputPath('line-question-dark-phone.png') });
  await composer.getByRole('button', { name: 'Send private question' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('line-question-dark-phone-actions.png') });
});

test('dark answered thread keeps a quiet edge and a usable follow-up on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose file' }).click();
  await page.getByTestId('filePalette/input').fill('devices.ts');
  await page.getByTestId('filePalette/row/src%2Fapi%2Fdevices.ts').click();
  await page.getByTestId('code/row/new/3/gutter').click();
  await page.getByRole('button', { name: 'Ask AI privately' }).click();
  await page.getByRole('textbox', { name: 'Private question', exact: true }).fill('Explain this line');
  await page.getByRole('button', { name: 'Send private question' }).click();

  const thread = page.locator('[data-testid^="ai/thread/"]').first();
  await expect(thread.getByRole('textbox', { name: 'Follow-up question' })).toBeVisible();
  await thread.screenshot({ path: testInfo.outputPath('thread-dark-phone.png') });
  await page.screenshot({ path: testInfo.outputPath('answered-thread-dark-phone.png') });
  expect(await thread.evaluate(element => getComputedStyle(element).borderLeftWidth)).toBe('0px');
});

test('file question and review results stay legible in the tablet workspace', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  await page.getByRole('button', { name: 'Ask AI about file' }).click();
  const composer = page.getByRole('textbox', { name: 'Private file question' });
  await expect(composer).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('file-question-dark-tablet.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: testInfo.outputPath('file-question-light-tablet.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('button', { name: 'Run AI review' }).click();
  await page.getByRole('tab', { name: /Findings/ }).click();
  await expect(page.getByTestId('ai-rail').getByTestId('ai/results')).toContainText('Potential null access');
  await page.screenshot({ path: testInfo.outputPath('findings-dark-tablet.png') });
});
