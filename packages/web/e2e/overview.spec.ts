import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });

const fileRows = /^files\/file\/[^/]+$/;

test('o opens the overview: the PR description renders as markdown, commits listed newest first', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.keyboard.press('o');
  await expect(page.getByTestId('overview')).toBeVisible();
  await expect(page.getByTestId('overview/title')).toHaveText('feat(catalog): virtualize item list');
  const desc = page.getByTestId('overview/description');
  await expect(desc.locator('h2')).toHaveText('What');            // "## What" was parsed, not printed
  await expect(desc.locator('li')).toHaveCount(3);
  await expect(desc.locator('code').first()).toBeVisible();
  await expect(page.getByTestId('overview/commits').getByRole('button')).toHaveCount(3);
  await expect(page.getByTestId('overview/commits').getByRole('button').first()).toContainText('render visible items');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('overview')).toHaveCount(0);
});

test('picking an older commit scopes files to it and goes read-only; the chip resets it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId(fileRows)).toHaveCount(7);
  await page.getByTestId('header/overviewButton').click();
  await page.getByTestId('overview/commits').getByRole('button').nth(1).click(); // "wire windowed rows", not the head
  await expect(page.getByTestId('overview/status')).toContainText('read-only');
  await page.getByTestId('overview/done').click();

  await expect(page.getByTestId('header/rangeChip')).toContainText('read-only');
  await expect(page.getByTestId(fileRows)).toHaveCount(1); // that commit only touched DeviceList.tsx
  await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  // comment anchors belong to the review head, so nothing is shown against an older commit's lines
  await expect(page.getByTestId('thread/301')).toHaveCount(0);
  await expect(page.getByTestId('code')).toHaveClass(/readonly/);

  await page.getByTestId('header/rangeChip/clear').click();
  await expect(page.getByTestId('header/rangeChip')).toHaveCount(0);
  await expect(page.getByTestId(fileRows)).toHaveCount(7);
  await expect(page.getByTestId('thread/301')).toBeVisible();
});

test('a range that still ends at the head keeps comments live', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId(fileRows)).toHaveCount(7);
  await page.keyboard.press('o');
  await page.getByTestId('overview/commits').getByRole('button').first().click(); // the newest commit
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('header/rangeChip')).not.toContainText('read-only');
  await expect(page.getByTestId(fileRows)).toHaveCount(2); // it touched DeviceList.tsx and de.json
  await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  await expect(page.getByTestId('code')).not.toHaveClass(/readonly/);
  await expect(page.getByTestId('thread/301')).toBeVisible();
});

test('shift-clicking a second commit spans the range', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId(fileRows)).toHaveCount(7);
  await page.keyboard.press('o');
  const rows = page.getByTestId('overview/commits').getByRole('button');
  await rows.nth(2).click();                                      // the oldest commit alone
  await expect(page.getByTestId(fileRows)).toHaveCount(5);
  await expect(page.getByTestId('header/rangeChip')).toContainText('read-only');
  await rows.first().click({ modifiers: ['Shift'] });             // extend up to the newest
  await expect(page.getByTestId(fileRows)).toHaveCount(7);
  await expect(page.getByTestId('header/rangeChip')).not.toContainText('read-only');
  await page.getByTestId('overview/wholeReview').click();
  await expect(page.getByTestId('header/rangeChip')).toHaveCount(0);
});

test('a file outside the selected range says so and offers a way back', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId(fileRows)).toHaveCount(7);
  await page.getByTestId('files/file/package.json').click();
  await page.keyboard.press('o');
  await page.getByTestId('overview/commits').getByRole('button').first().click(); // c3 never touched package.json
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('code/noDiff')).toContainText('Nothing changed in this file');
  await page.getByTestId('code/noDiff/clearRange').click();
  await expect(page.getByTestId('header/rangeChip')).toHaveCount(0);
  await expect(page.locator('table.diff')).toBeVisible();
});
