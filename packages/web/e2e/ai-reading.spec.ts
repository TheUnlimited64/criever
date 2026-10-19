import { expect, test } from '@playwright/test';

const findingBody = '**Support the standalone API origin**\n\nWhen the service runs separately, the new request goes to the hosted shell instead of the API.\n\nFor example:\n\n```ts\n// Expected\nfetch(apiOrigin + \"/devices\")\n```\n\n- Confirm both deployment modes.\n- See the [contract](https://example.com/contract).';

const limitation = 'The external API contract is unavailable in this checkout. Required browser integration evidence is also missing. The review inspected committed code but cannot claim a complete result. '.repeat(12);

test.beforeEach(async ({ request }) => { await request.post('/__reset'); });

test('long incomplete diagnostics never squeeze findings and provisional results also appear in comments and code', async ({ page, request }, testInfo) => {
  const pr = await (await request.get('/api/pr')).json();
  await page.route('**/api/ai', async route => {
    const response = await route.fetch();
    const state = await response.json();
    state.activeReviews = [{ id: 'long-run', harnessId: 'Codex', head: pr.sourceHead, startedAt: new Date().toISOString(), status: 'incomplete', error: limitation, observations: [], findings: [{ id: 'long-finding', path: 'src/api/devices.ts', line: 3, side: 'new', body: findingBody, severity: 'warning', anchorCommit: pr.sourceHead, reviewId: 'long-run' }], lookouts: [1, 2].map(n => ({ id: `long-lookout-${n}`, path: 'src/api/devices.ts', line: 5, side: 'new', body: `Confirm deployment contract ${n} before shipping this change.`, anchorCommit: pr.sourceHead, reviewId: 'long-run' })) }];
    await route.fulfill({ response, json: state });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('tab', { name: /Findings/ }).click();
  const rail = page.getByTestId('ai-rail');
  const scroll = page.getByTestId('ai/scroll');
  const first = rail.getByTestId('ai/result/long-finding');
  for (const width of [375, 768, 1100, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(first).toBeInViewport();
    const bounds = await rail.boundingBox();
    const body = await scroll.boundingBox();
    expect(body!.height).toBeGreaterThan(bounds!.height * 0.6);
    expect(await rail.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`findings-${width}.png`) });
  }
  await expect(first.locator('strong')).toHaveText('Support the standalone API origin');
  await expect(first.locator('pre code')).toContainText('fetch(apiOrigin');
  await expect(first.locator('li')).toHaveCount(2);
  await expect(first.getByRole('link')).toHaveCount(0);
  await page.getByRole('tab', { name: /Findings/ }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toBeFocused();
  await expect(page.getByLabel('General question')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Findings/ })).toHaveAttribute('aria-selected', 'true');
  await expect(first).toBeInViewport();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: testInfo.outputPath('findings-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await rail.getByTestId('ai/review-status').locator('summary').click();
  await expect(rail.getByRole('alert')).toHaveText(limitation.trim());
  const height = (await scroll.boundingBox())!.height;
  await first.scrollIntoViewIfNeeded();
  await expect(first).toBeInViewport();
  expect((await scroll.boundingBox())!.height).toBe(height);
  await page.getByRole('button', { name: 'Close AI chat' }).click();
  const comments = page.getByTestId('comments/group/ai');
  await expect(comments.getByTestId('comments/group/ai/count')).toHaveText('3');
  await expect(comments).toContainText('Provisional finding');
  await expect(comments).toContainText('Confirm deployment contract 2');
  await comments.getByTestId('ai/result/long-finding').click();
  const inline = page.getByTestId('ai/provisional/long-finding');
  await expect(inline).toBeVisible();
  await expect(inline).toContainText('not available for approval');
  await expect(inline.locator('pre code')).toContainText('fetch(apiOrigin');
  await expect(inline.getByRole('link', { name: 'contract' })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(inline.getByRole('button', { name: 'Approve draft' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('provisional-in-comments-and-code.png') });
});
