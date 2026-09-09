import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });
test('opens the first file as a unified diff with both gutters and coloured rows', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  await expect(page.getByTestId('code/path')).toHaveText('src/devices/DeviceList.tsx');
  await expect(page.getByTestId('code/stat')).toContainText('+7');
  const del = page.getByTestId('code/row/old/3'); await expect(del).toHaveClass(/del/);
  await expect(del.locator('td.ln.o')).toHaveText('3'); await expect(del.locator('td.ln').nth(1)).toHaveText('');
  const add = page.getByTestId('code/row/new/3'); await expect(add).toHaveClass(/add/); await expect(add).toContainText('useDeviceRows');
  await expect(page.getByTestId('code/hunk/0')).toBeVisible();
  await expect(page.locator('.hljs-keyword').first()).toBeVisible();
});
test('split view shows two columns; toggle persists', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  await page.getByTestId('code/modeSplit').click();
  await expect(page.getByTestId('code/diff')).toHaveAttribute('data-split', 'true');
  await page.reload(); await expect(page.getByTestId('code/diff')).toHaveAttribute('data-split', 'true');
  await page.getByTestId('code/modeUnified').click();
});
test('expand increases context', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/package.json').click();
  await expect(page.getByTestId('code/hunk/0')).toBeVisible();
  const rows = page.getByTestId(/^code\/row\//);
  const before = await rows.count();
  await page.getByTestId('code/hunk/0/expand').click();
  await expect.poll(() => rows.count()).toBeGreaterThan(before);
});
test('deleted and added files render', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fhooks%2FuseIntersection.ts').click();
  await expect(page.getByTestId(/^code\/row\/old\//).first()).toHaveClass(/del/);
  await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await expect(page.getByTestId('code/row/new/8')).toContainText('estimateSize');
});
test('gutter cell stays clickably wide with long lines in both unified and split view', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  await expect(page.locator('tr.line td.g').first()).toBeVisible();
  const gutterWidth = () => page.evaluate(() => document.querySelector('tr.line td.g')!.getBoundingClientRect().width);
  expect(await gutterWidth()).toBeGreaterThanOrEqual(20);
  await page.getByTestId('code/modeSplit').click();
  await expect(page.getByTestId('code/diff')).toHaveAttribute('data-split', 'true');
  expect(await gutterWidth()).toBeGreaterThanOrEqual(20);
  await page.getByTestId('code/modeUnified').click();
});
