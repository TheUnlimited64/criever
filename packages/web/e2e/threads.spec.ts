import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('/__reset'); });
test('changed-since thread renders inline at the new line with reply and badge', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  const card = page.getByTestId('thread/301');
  await expect(card).toHaveClass(/changed/);
  await expect(card.getByTestId('thread/301/chip')).toHaveText('changed since your comment');
  await expect(card.getByTestId('thread/301/reply/302')).toContainText('Done in');
  // it sits right after new line 13 (hunk.newStart of the c2→c3 change)
  const rows = page.locator('table.diff tbody > tr');
  const idx = await rows.evaluateAll(trs => trs.findIndex(tr => tr.querySelector('[data-testid="thread/301"]')));
  expect(await rows.nth(idx - 1).getAttribute('data-testid')).toBe('code/row/new/13');
});
test('open thread from a colleague on line 1', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  await expect(page.getByTestId('thread/303').getByTestId('thread/303/chip')).toHaveText('open');
});
test('rail groups and click-to-focus', async ({ page }) => {
  await page.goto('/');
  // 301 (changed, mine) + 307 (fileDeleted, also grouped under "changed since") + 309 (changed, colleague's)
  await expect(page.getByTestId('comments/group/changed/count')).toHaveText('3');
  await expect(page.getByTestId('comments/group/open/count')).toHaveText('3');   // 303, 304, 306 (general)
  await expect(page.getByTestId('comments/group/resolved/count')).toHaveText('1');
  await expect(page.getByTestId('comments/group/drafts/count')).toHaveText('0');
  await page.getByTestId('comments/item/304').click();
  await expect(page.getByTestId('code/path')).toHaveText('src/api/devices.ts');
  await expect(page.getByTestId('thread/304')).toBeInViewport();
});
test('resolved thread renders collapsed and expands on toggle', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/package.json').click();
  const card = page.getByTestId('thread/305');
  await expect(card).toHaveClass(/collapsed/);
  await expect(card.getByTestId('thread/305/body')).toBeHidden();
  await card.getByTestId('thread/305/expand').click();
  await expect(card).not.toHaveClass(/collapsed/);
  await expect(card.getByTestId('thread/305/body')).toBeVisible();
});

test('rail keeps its position and marks the current comment across file changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto('/');
  const rail = page.getByTestId('comments');
  const first = page.getByTestId('comments/item/304');
  await first.scrollIntoViewIfNeeded();
  const scrollTop = await rail.evaluate(el => el.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  await first.click();
  await expect(first).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('thread/304')).toBeInViewport();
  await expect(first).toBeFocused();
  expect(await rail.evaluate(el => el.scrollTop)).toBe(scrollTop);

  const next = page.getByTestId('comments/item/305');
  await next.scrollIntoViewIfNeeded();
  const nextScrollTop = await rail.evaluate(el => el.scrollTop);
  await next.click();
  await expect(next).toHaveAttribute('aria-current', 'true');
  await expect(first).not.toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('thread/305')).toBeInViewport();
  await expect(next).toBeFocused();
  expect(await rail.evaluate(el => el.scrollTop)).toBe(nextScrollTop);
});
