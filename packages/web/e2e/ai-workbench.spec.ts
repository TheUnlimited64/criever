import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request, baseURL }) => { await request.post(`${baseURL}/__reset`); });

test('two reviews finish independently while chat stays usable and every result is navigable', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  let releaseFirst = () => {};
  let releaseSecond = () => {};
  const first = new Promise<void>(resolve => { releaseFirst = resolve; });
  const second = new Promise<void>(resolve => { releaseSecond = resolve; });
  let started = 0;
  await page.route('**/api/ai/review', async route => {
    started++;
    await (started === 1 ? first : second);
    await route.continue();
  });
  await page.getByRole('button', { name: 'Run AI review' }).click();
  await expect(page.getByRole('button', { name: 'Run AI review' })).toBeEnabled();
  await page.getByRole('button', { name: 'Run AI review' }).click();
  await expect(page.getByText('2 reviews running')).toBeVisible();
  await page.getByLabel('General question').fill('Render markdown while reviewing');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  await expect(page.getByTestId('ai/general-messages').locator('strong')).toContainText('bold answer');
  releaseSecond();
  await expect(page.getByTestId('ai/review-result')).toContainText('1 review');
  releaseFirst();
  await expect(page.getByTestId('ai/review-result')).toContainText('2 reviews');
  await page.getByRole('tab', { name: /Findings/ }).click();
  await expect(page.getByTestId('ai-rail').getByTestId('ai/results')).toContainText('Potential null access');
  await expect(page.getByTestId('ai-rail').locator('[data-testid^="ai/result/"]')).toHaveCount(6);
  await page.screenshot({ path: testInfo.outputPath('findings-desktop.png') });
  await page.getByRole('button', { name: /Secondary finding/ }).first().click();
  await expect(page.getByTestId('code/row/new/5')).toBeInViewport();
  await expect(page.getByTestId('comments/group/ai')).toContainText('Potential null access');
  await page.reload();
  await expect(page.getByTestId('comments/group/ai').locator('[data-testid^="ai/result/"]')).toHaveCount(6);
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('tab', { name: /Findings/ }).click();
  await expect(page.getByTestId('ai-rail').getByTestId('ai/results')).toContainText('2 reviews');
});

test('closing the rail does not discard a pending chat or its reply', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  let release = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ai/chat', async route => { await blocked; await route.continue(); });
  await page.getByLabel('General question').fill('Render markdown, please');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Thinking about your question' })).toBeVisible();
  await page.getByRole('button', { name: 'Close AI chat' }).click();
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.getByLabel('General question')).toHaveValue('Render markdown, please');
  await expect(page.getByRole('status', { name: 'Thinking about your question' })).toBeVisible();
  release();
  const response = page.getByTestId('ai/general-messages').locator('.ai-message.assistant .mdPreview');
  await expect(response.locator('strong')).toHaveText('bold answer');
  await expect(response.locator('code')).toHaveText('Row.from(QuerySolution)');
  await expect(response.locator('li')).toHaveCount(3);
  await expect(response.getByText('unsafe')).not.toHaveAttribute('href');
  await expect(response.getByRole('link', { name: 'source' })).toHaveAttribute('rel', 'noopener noreferrer');
  await page.screenshot({ path: testInfo.outputPath('chat-markdown.png') });
  await page.getByRole('button', { name: 'Close AI chat' }).click();
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await expect(response.locator('strong')).toHaveText('bold answer');
  await page.reload();
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await expect(response.locator('strong')).toHaveText('bold answer');
});

test('an old-side result navigates after a delayed diff loads in split view', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code/modeSplit').click();
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByLabel('AI harness').selectOption('fixture-old');
  await page.getByRole('button', { name: 'Run AI review' }).click();
  await page.getByRole('tab', { name: /Findings/ }).click();
  const result = page.getByTestId('ai-rail').getByRole('button', { name: 'Finding: Old-side regression' });
  await expect(result).toBeVisible();
  let release = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/diff?**', async route => {
    if (new URL(route.request().url()).searchParams.get('path') === 'src/api/devices.ts') await blocked;
    await route.continue();
  });
  await result.click();
  await expect(page.getByTestId('ai-rail')).toBeHidden();
  await expect(page.getByTestId('code/path')).toContainText('devices.ts');
  release();
  await expect(page.getByTestId('code/row/old/4/gutter')).toBeInViewport();
  await expect(page.getByTestId('code/row/old/4/gutter').locator('..')).toHaveClass(/cursor/);
});

test('a finding from an earlier revision stays in the rail with an explanation', async ({ page }) => {
  await page.route('**/api/ai', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const state = await response.json();
    if (state.findings?.length) state.findings[0].anchorCommit = 'outdated-head';
    if (state.lookouts?.length) state.lookouts[0].anchorCommit = 'outdated-head';
    await route.fulfill({ response, json: state });
  });
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('button', { name: 'Run AI review' }).click();
  await page.getByRole('tab', { name: /Findings/ }).click();
  await expect(page.getByTestId('ai-rail').getByRole('button', { name: 'Finding: Potential null access' })).toBeVisible();
  await expect(page.getByTestId('ai-rail').getByRole('button', { name: 'Look-out: Check authorization' })).toBeVisible();
  await expect(page.locator('[data-testid^="ai/finding/"]').filter({ hasText: 'Potential null access' })).toHaveCount(0);
  await expect(page.locator('[data-testid^="ai/lookout/"]').filter({ hasText: 'Check authorization' })).toHaveCount(0);
  await expect(page.locator('[data-testid^="ai/finding/"]').filter({ hasText: 'Secondary finding' })).toBeVisible();
  await page.getByTestId('ai-rail').getByRole('button', { name: 'Finding: Potential null access' }).click();
  await expect(page.getByTestId('ai-rail')).toBeVisible();
  await expect(page.getByTestId('ai-rail').getByRole('alert')).toContainText('earlier revision');
});

test('line conversation accepts follow-ups on the same anchor and renders answers', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  await page.getByTestId('code/row/new/3/gutter').click();
  await page.getByRole('button', { name: 'Ask AI privately' }).click();
  await page.getByRole('textbox', { name: 'Private question', exact: true }).fill('Explain this line');
  await page.getByRole('button', { name: 'Send private question' }).click();
  const thread = page.locator('[data-testid^="ai/thread/"]').first();
  await expect(thread).toContainText('Fixture answer');
  await thread.getByRole('textbox', { name: 'Follow-up question' }).fill('Render markdown as a follow-up');
  await thread.getByRole('button', { name: 'Send follow-up' }).click();
  await expect(thread.locator('.ai-message.user')).toHaveCount(2);
  await expect(thread.locator('.ai-message.assistant .mdPreview strong')).toHaveText('bold answer');
  await page.screenshot({ path: testInfo.outputPath('line-followup.png') });
  const followUp = thread.getByRole('button', { name: 'Send follow-up' });
  await followUp.scrollIntoViewIfNeeded();
  await expect(followUp).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('line-followup-scrolled.png') });
  await page.reload();
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  await expect(page.locator('[data-testid^="ai/thread/"] .ai-message.assistant')).toHaveCount(2);
  await expect(page.getByTestId('header/draftCount')).toContainText('0 drafts');
});

test('earlier-revision code conversations are readable but cannot start a new-head follow-up', async ({ page, request, baseURL }, testInfo) => {
  await request.post(`${baseURL}/__seed/old-line-ai-chat`);
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  const historical = page.locator('[data-testid^="ai/thread/"]').filter({ hasText: 'Previous head line question' });
  await expect(historical).toContainText('Earlier revision');
  await expect(historical.getByRole('textbox', { name: 'Follow-up question' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('historical-line-thread.png') });
  await page.getByTestId('code/row/new/3/gutter').click();
  await page.getByRole('button', { name: 'Ask AI privately' }).click();
  await page.getByRole('textbox', { name: 'Private question', exact: true }).fill('New head question');
  await page.getByRole('button', { name: 'Send private question' }).click();
  const current = page.locator('[data-testid^="ai/thread/"]').filter({ hasText: 'New head question' });
  await expect(current.getByRole('textbox', { name: 'Follow-up question' })).toBeVisible();
  await expect(historical).not.toContainText('New head question');
});

test('compact action tabs align in both composer modes on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await page.getByTestId('code/row/new/3/gutter').first().click();
  const tabs = page.getByRole('group', { name: 'Line action' });
  const comment = tabs.getByRole('button', { name: 'PR comment' });
  const ai = tabs.getByRole('button', { name: 'Ask AI privately' });
  const before = await Promise.all([comment.boundingBox(), ai.boundingBox()]);
  await ai.click();
  const after = await Promise.all([comment.boundingBox(), ai.boundingBox()]);
  expect(before[0]?.y).toBe(after[0]?.y);
  expect(before[1]?.y).toBe(after[1]?.y);
  expect(before[0]?.height).toBe(before[1]?.height);
  expect(after[0]?.height).toBe(after[1]?.height);
  expect(after[0]?.height).toBeLessThan(36);
  await page.screenshot({ path: testInfo.outputPath('compact-line-tabs.png') });
});

test('changed comments and toolbar controls stay reachable on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose file' }).click();
  await page.getByTestId('filePalette/input').fill('devices.ts');
  await page.getByTestId('filePalette/row/src%2Fapi%2Fdevices.ts').click();
  const card = page.getByTestId('code').locator('.card.changed').first();
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(375);
  const toolbar = page.getByTestId('code').locator('.code-hd .right');
  await toolbar.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(page.getByTestId('code/openInVsCode')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('phone-comment-and-toolbar.png') });
});
