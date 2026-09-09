import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });

test('reply becomes a draft reply inside the card and counts as a draft', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  const card = page.getByTestId('thread/303');
  await card.getByTestId('thread/303/reply').click();
  await card.getByTestId('composer/text').fill('Fixed the order in the next push.');
  await card.getByTestId('composer/save').click();
  await expect(card.getByTestId(/^thread\/303\/draftReply\/[^/]+$/)).toContainText('Fixed the order');
  await expect(page.getByTestId('header/draftCount')).toContainText('1 draft');
  await expect(page.getByTestId('comments/group/drafts')).toContainText('reply');
});
test('resolve flips the card to resolved and moves it in the rail; stub receives the call', async ({ page, request }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  await page.getByTestId('thread/301/resolve').click();
  await expect(page.getByTestId('thread/301/chip')).toHaveText('resolved');
  await expect(page.getByTestId('thread/301')).not.toHaveClass(/changed/);
  await expect(page.getByTestId('thread/301/resolve')).toHaveCount(0);
  await expect(page.getByTestId('comments/group/resolved/count')).toHaveText('2');
  expect(await (await request.get('http://127.0.0.1:4799/__stub/recorded')).json()).toContainEqual({ resolve: 301 });
});
