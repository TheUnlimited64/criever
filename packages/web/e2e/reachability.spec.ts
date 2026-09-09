import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });

test('every thread the API returns renders a reachable card with a working resolve control', async ({ page, request }) => {
  const { threads } = await (await request.get('http://127.0.0.1:4799/api/comments')).json();
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  // the rail's groups only render once useComments() has resolved — wait for that before counting
  // items, otherwise the first thread checked races the fetch and looks orphaned when it isn't.
  await expect(page.getByTestId('comments/group/open/count')).toBeVisible();
  for (const t of threads as { root: { id: number; resolved: boolean } }[]) {
    const item = page.getByTestId(`comments/item/${t.root.id}`);
    if (await item.count()) await item.click();
    await expect(page.getByTestId(`thread/${t.root.id}`)).toBeVisible();
    if (!t.root.resolved) await expect(page.getByTestId(`thread/${t.root.id}/resolve`)).toBeVisible();
  }
});

test('a fileDeleted thread is reachable in the code pane of its (now gone) file and resolves', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/file/src%2Fhooks%2FuseIntersection.ts').click();
  const card = page.getByTestId('thread/307');
  await expect(card.getByTestId('thread/307/chip')).toHaveText('file removed');
  await card.getByTestId('thread/307/resolve').click();
  await expect(card.getByTestId('thread/307/chip')).toHaveText('resolved');
});

test('a general PR comment (no path, no line) resolves straight from the rail', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  const card = page.getByTestId('thread/306');
  await expect(card).toBeVisible();
  await card.getByTestId('thread/306/resolve').click();
  await expect(card.getByTestId('thread/306/chip')).toHaveText('resolved');
});

test('the rail gives a colleague\'s comment a visibly different avatar than mine', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await expect(page.getByTestId('comments/item/301').locator('.avatar')).not.toHaveClass(/other/); // mine
  await expect(page.getByTestId('comments/item/303').locator('.avatar')).toHaveClass(/other/);      // colleague's
});

test('the amber chip names the colleague who wrote the comment, not "your"', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/file/src%2Fapi%2Fdevices.ts').click();
  await expect(page.getByTestId('thread/309/chip')).toHaveText("changed since Sam's comment");
  // the group heading must not claim "your" either, once it holds someone else's thread too
  await expect(page.getByTestId('comments/group/changed')).not.toContainText('Changed since your comment');
});
