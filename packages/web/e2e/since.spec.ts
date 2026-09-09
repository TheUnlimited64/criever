import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });

test('show what changed reveals the hunk between anchor and head; whole-file link switches base', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  const card = page.getByTestId('thread/301');
  await expect(card.getByTestId('thread/301/since')).toHaveCount(0);
  await card.getByTestId('thread/301/showChanged').click();
  const since = card.getByTestId('thread/301/since'); await expect(since).toBeVisible();
  await expect(since.locator('tr.del').filter({ hasText: 'items.map' })).toBeVisible();
  await expect(since.locator('tr.add').first()).toContainText('rows.map');
  // proves the box shows the anchor→head diff, not the PR diff: useIntersection was already gone by the anchor commit
  await expect(since).not.toContainText('useIntersection');
  await card.getByTestId('thread/301/wholeFileSince').click();
  // the range now scopes the review, and it still ends at the head, so comments stay live
  await expect(page.getByTestId('header/rangeChip')).toBeVisible();
  await expect(page.getByTestId('header/rangeChip')).not.toContainText('read-only');
  await expect(page.locator('tr.add')).toHaveCount(3); // c2→c3 only added the 3 rows.map lines
  await page.getByTestId('header/rangeChip').getByRole('button').click();
  await expect(page.getByTestId('header/rangeChip')).toHaveCount(0);
});
