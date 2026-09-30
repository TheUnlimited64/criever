import { test, expect } from '@playwright/test';

const hiddenCodeCases = [
  { width: 375, panel: 'files' },
  { width: 375, panel: 'comments' },
  { width: 768, panel: 'comments' },
] as const;

test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:4799/__reset');
});

for (const { width, panel } of hiddenCodeCases) {
  test(`Find shortcut reveals code from ${panel} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByTestId(`header/panel/${panel}`).click();
    await expect(page.getByTestId('code')).toBeHidden();

    await page.keyboard.press('Control+f');

    await expect(page.getByTestId('findBar/input')).toBeVisible();
    await expect(page.getByTestId('findBar/input')).toBeFocused();
    await expect(page.getByTestId('header/panel/code')).toHaveAttribute('aria-pressed', 'true');
  });
}

test('opening a file from the mobile files panel returns to code', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByTestId('header/panel/files').click();
  await expect(page.getByTestId('files')).toBeVisible();
  await expect(page.getByTestId('code')).toBeHidden();

  await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();

  await expect(page.getByTestId('code')).toBeVisible();
  await expect(page.getByTestId('files')).toBeHidden();
  await expect(page.getByTestId('code/path')).toContainText('DeviceList.tsx');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('inline comments remain reachable on tablet through the comments panel', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await page.getByTestId('header/panel/comments').click();
  await expect(page.getByTestId('comments')).toBeVisible();

  await page.getByTestId('comments/item/301').click();

  await expect(page.getByTestId('code')).toBeVisible();
  await expect(page.getByTestId('thread/301')).toBeVisible();
  await expect(page.getByTestId('header/panel/code')).toHaveAttribute('aria-pressed', 'true');
});

test('an unfinished mobile comment survives switching workspace panels', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByTestId('header/panel/files').click();
  await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('code/row/new/8/gutter').click();
  await page.getByTestId('composer/text').fill('Keep this unfinished review note');

  await page.getByTestId('header/panel/comments').click();
  await page.getByTestId('header/panel/code').click();

  await expect(page.getByTestId('composer/text')).toHaveValue('Keep this unfinished review note');
});

test('mobile overview stays within the viewport and restores keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const opener = page.getByTestId('header/overviewButton');

  await opener.click();

  const dialog = page.getByRole('dialog', { name: 'Review overview and commits' });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error('Overview has no rendered bounds');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('inline comment actions fit the code pane beside long code lines', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();

  const reply = page.getByTestId('thread/303/reply');
  await expect(reply).toBeVisible();
  const bounds = await reply.boundingBox();
  const pane = await page.getByTestId('code/body').boundingBox();
  if (!bounds || !pane) throw new Error('Comment actions or code pane have no rendered bounds');
  expect(bounds.x).toBeGreaterThanOrEqual(pane.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(pane.x + pane.width);
});
