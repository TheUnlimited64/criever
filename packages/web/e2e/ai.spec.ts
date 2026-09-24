import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ request, baseURL }) => { await request.post(`${baseURL}/__reset`); });

async function openFixtureFile(page: Page) {
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
}

async function runReview(page: Page) {
  await page.goto('/');
  await openFixtureFile(page);
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.getByLabel('AI harness')).toHaveValue('fixture-harness');
  await page.getByRole('button', { name: 'Run AI review' }).click();
  await expect(page.locator('[data-testid^="ai/finding/"]').filter({ hasText: 'Potential null access' })).toBeVisible();
  await expect(page.locator('[data-testid^="ai/lookout/"]').filter({ hasText: 'Check authorization' })).toBeVisible();
}

test('AI findings and look-outs remain visible beside their diff lines when chat closes', async ({ page }) => {
  await runReview(page);
  const finding = page.locator('[data-testid^="ai/finding/"]').filter({ hasText: 'Potential null access' });
  const lookout = page.locator('[data-testid^="ai/lookout/"]').filter({ hasText: 'Check authorization' });
  await page.getByRole('button', { name: 'Close AI chat' }).click();
  await expect(finding).toBeVisible();
  await expect(lookout).toBeVisible();
  await expect(page.getByTestId('code/row/new/3/gutter')).toBeVisible();
});

test('contextual Q&A is separate from general chat and persists after reload', async ({ page }) => {
  await page.goto('/');
  await openFixtureFile(page);
  await page.getByRole('button', { name: 'Ask AI about line 3' }).click();
  await page.getByRole('textbox', { name: 'Private question', exact: true }).fill('Why does this line need a guard?');
  await page.getByRole('button', { name: 'Send private question' }).click();
  const thread = page.locator('[data-testid^="ai/thread/"]').filter({ hasText: 'Fixture answer' });
  await expect(thread).toBeVisible();
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.getByLabel('General question')).toBeVisible();
  const summary = page.locator('[data-testid^="ai/thread-summary/"]').filter({ hasText: 'Why does this line need a guard?' });
  await expect(summary).toBeVisible();
  await expect(page.locator('[data-testid^="ai/thread-summary/"]').filter({ hasText: 'Fixture answer' })).toHaveCount(0);
  await page.getByLabel('General question').fill('Summarize the repository change');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  const generalChat = page.getByRole('heading', { name: 'General chat' }).locator('..');
  await expect(generalChat).toContainText('Summarize the repository change');
  await expect(generalChat).toContainText('Fixture answer');
  await summary.click();
  await expect(page.getByTestId('code/row/new/3')).toBeInViewport();
  await page.reload();
  await openFixtureFile(page);
  await expect(page.locator('[data-testid^="ai/thread/"]').filter({ hasText: 'Fixture answer' })).toBeVisible();
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'General chat' }).locator('..')).toContainText('Summarize the repository change');
});

test('general chat shows the current head conversation when an older head has history', async ({ page, request, baseURL }) => {
  await request.post(`${baseURL}/__seed/old-ai-chat`);
  await page.goto('/');
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByLabel('General question').fill('Question at current head');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  const chat = page.getByRole('heading', { name: 'General chat' }).locator('..');
  await expect(chat).toContainText('Question at current head');
  await expect(chat).toContainText('Fixture answer');
  await expect(chat).not.toContainText('Previous head question');
});

test('ordinary gutter click still opens the comment composer while AI chat is open', async ({ page }) => {
  await page.goto('/');
  await openFixtureFile(page);
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByTestId('code/row/new/3/gutter').click({ position: { x: 1, y: 10 } });
  await expect(page.getByTestId('composer')).toBeVisible();
  await page.getByTestId('composer/cancel').click();
});

test('historical file view does not offer head-revision AI questions or results', async ({ page }) => {
  await runReview(page);
  await page.getByTestId('code/atPicker').selectOption({ label: 'file at merge-base' });
  await expect(page.getByRole('button', { name: 'Ask AI about line 3' })).toHaveCount(0);
  await expect(page.locator('[data-testid^="ai/finding/"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="ai/lookout/"]')).toHaveCount(0);
});

test('an unsaved reword cannot be approved until the visible wording is saved', async ({ page }) => {
  await runReview(page);
  const findingId = await page.locator('[data-testid^="ai/finding/"]').filter({ hasText: 'Potential null access' }).getAttribute('data-testid');
  if (!findingId) throw new Error('expected AI finding missing');
  const finding = page.getByTestId(findingId);
  await finding.getByRole('button', { name: 'Reword' }).click();
  await expect(finding.getByLabel('Edit finding')).toHaveValue('Fixture reword');
  await expect(finding.getByRole('button', { name: 'Approve draft' })).toBeDisabled();
  await finding.getByRole('button', { name: 'Save finding' }).click();
  await finding.getByRole('button', { name: 'Approve draft' }).click();
  await page.getByTestId('header/publishButton').click();
  await expect(page.getByTestId('publishSheet')).toContainText('Fixture reword');
});

test('only edited and approved AI findings are saved or published', async ({ page, request, baseURL }) => {
  await runReview(page);
  const findingId = await page.locator('[data-testid^="ai/finding/"]').filter({ hasText: 'Potential null access' }).getAttribute('data-testid');
  if (!findingId) throw new Error('AI review did not render the expected finding');
  const finding = page.getByTestId(findingId);
  const secondary = page.locator('[data-testid^="ai/finding/"]').filter({ hasText: 'Secondary finding' });
  await finding.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Edit finding').fill('Edited finding');
  await page.getByRole('button', { name: 'Save finding' }).click();
  await finding.getByRole('button', { name: 'Reword' }).click();
  await expect(page.getByLabel('Edit finding')).toHaveValue('Fixture reword');
  await page.getByRole('button', { name: 'Save finding' }).click();
  await finding.getByRole('button', { name: 'Approve draft' }).click();
  await expect(page.getByTestId('header/draftCount')).toContainText('1 draft');
  await secondary.getByRole('button', { name: 'Delete' }).click();
  await page.reload();
  await openFixtureFile(page);
  await expect(page.locator('[data-testid^="ai/finding/"]').filter({ hasText: 'Fixture reword' })).toHaveCount(0);
  await page.getByTestId('header/publishButton').click();
  await expect(page.getByTestId('publishSheet')).toContainText('Fixture reword');
  await expect(page.getByTestId('publishSheet')).not.toContainText('Potential null access');
  await page.getByTestId('publishSheet/confirm').click();
  await expect.poll(async () => {
    const comments = await request.get(`${baseURL}/api/comments`).then(response => response.json());
    return JSON.stringify(comments);
  }).toContain('Fixture reword');
  const persisted = await request.get(`${baseURL}/api/comments`).then(response => response.json());
  expect(JSON.stringify(persisted)).not.toContain('Potential null access');
});

test('AI rail stays within narrow, tablet, and desktop viewports', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
    await expect(page.getByLabel('AI harness')).toBeVisible();
    await expect(page.getByLabel('General question')).toBeVisible();
    const bounds = await page.getByTestId('ai-rail').boundingBox();
    expect(bounds && bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`ai-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Close AI chat' }).click();
  }
});
