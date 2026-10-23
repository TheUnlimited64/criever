import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request, baseURL }) => { await request.post(`${baseURL}/__reset`); });

test('look-out discussions stay in the diff and reopen through compact side-panel previews', async ({ page, request }, testInfo) => {
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
  await expect(rail.getByRole('button', { name: 'Continue discussion' })).toHaveCount(0);
  await expect(rail.locator('.ai-lookout-discussion')).toHaveCount(0);
  // Clicking the text itself (not just the file location) navigates to the diff.
  await rail.locator('.ai-lookout-preview .ai-result-body').click();
  await expect(rail).toBeHidden();
  await expect(lookout).toBeInViewport();
  await lookout.getByRole('button', { name: 'Continue discussion' }).click();
  await expect(lookout.locator('.ai-message.assistant')).toHaveCount(2);
  await expect(lookout).toContainText('How could I verify this concern?');
  await lookout.getByRole('button', { name: 'Close discussion' }).click();
  // The comments overview uses the same full-row navigation, including keyboard activation.
  await page.getByTestId('files/file/package.json').click();
  const comments = page.getByTestId('comments');
  await expect(comments.locator('.ai-lookout-discussion')).toHaveCount(0);
  const preview = comments.locator('.ai-lookout-preview');
  await preview.focus();
  await page.keyboard.press('Enter');
  await expect(lookout).toBeInViewport();
  await expect(page.getByTestId('code/row/new/3')).toHaveClass(/cursor/);
  const state = await request.get('/api/ai').then(response => response.json());
  expect(state.conversation).toEqual([]);
  expect(Object.keys(state.threads)).toHaveLength(1);
  expect(Object.keys(state.threads)[0]).toMatch(/^lookout:/);
});

for (const theme of ['dark', 'light'] as const) {
  test(`look-out design stays readable in ${theme} mode and on a phone`, async ({ page, request }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await request.post('/api/ai/review', { data: { harnessId: 'fixture-harness' } });
    await expect.poll(async () => (await request.get('/api/ai').then(r => r.json())).lookouts.length).toBe(1);
    const state = await request.get('/api/ai').then(r => r.json());
    const lookoutId = state.lookouts[0].id;
    await request.patch(`/api/ai/lookouts/${encodeURIComponent(lookoutId)}`, { data: {
      body: '**Confirm authorization before returning the device list**\n\nThis handler returns devices through `listDevices()`, but the change does not show where access is checked. If the route is reachable without authentication, device details could be exposed.\n\nCheck whether the router already applies an authorization guard. If it does, this concern can be dismissed; otherwise, add the check before returning the list.',
    } });
    await page.goto('/');
    await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
    const lookout = page.getByTestId(`ai/lookout/${lookoutId}`);
    await expect(lookout).toContainText('Confirm authorization');
    const preview = page.getByTestId('comments').locator('.ai-lookout-preview');
    await expect(preview).toContainText('Confirm authorization');
    await expect(preview).not.toContainText('This handler returns devices');
    await expect(page.getByTestId('comments').locator('.ai-lookout-discussion')).toHaveCount(0);
    await lookout.screenshot({ path: testInfo.outputPath(`lookout-${theme}.png`) });
    await lookout.getByRole('button', { name: 'Discuss look-out' }).click();
    await expect(lookout.getByRole('textbox', { name: 'Look-out question', exact: true })).toBeVisible();
    await lookout.screenshot({ path: testInfo.outputPath(`discussion-${theme}.png`) });
    await page.setViewportSize({ width: 375, height: 812 });
    await lookout.scrollIntoViewIfNeeded();
    const box = await lookout.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(375);
    expect(await lookout.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await lookout.getByRole('button', { name: 'Send look-out question' }).scrollIntoViewIfNeeded();
    await expect(lookout.getByRole('button', { name: 'Send look-out question' })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`lookout-${theme}-phone.png`) });
  });
}
