import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });

test('shell renders header, files, code, rail, footer from fixture PR', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('header/title')).toHaveText('feat(catalog): virtualize item list');
  await expect(page.getByTestId('header/prNumber')).toHaveText('#241');
  await expect(page.getByTestId('header/newCommitsBanner')).toContainText('1 new commit');
  await expect(page.getByTestId('header/draftCount')).toContainText('0 drafts');
  await expect(page.getByTestId('files')).toBeVisible();
  await expect(page.getByTestId('code')).toBeVisible();
  await expect(page.getByTestId('comments')).toBeVisible();
  await expect(page.getByTestId('footer')).toBeVisible();
  const files = page.getByTestId(/^files\/file\/[^/]+$/);
  await expect(files).toHaveCount(7);
  await expect(page.getByTestId('files/file/src%2Fdevices%2FDeviceRow.tsx').getByTestId(/viewed$/)).toHaveClass(/on/);
  await expect(page.getByTestId('files/count')).toHaveText('7 · 1 viewed');
});

test('fonts are IBM Plex, not fallbacks', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  expect(await page.evaluate(() => document.fonts.check('13px "IBM Plex Sans"'))).toBe(true);
  expect(await page.evaluate(() => document.fonts.check('12px "IBM Plex Mono"'))).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('IBM Plex Sans');
});

test('Open in VS Code asks the server for the current file', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  const popup = page.waitForEvent('popup').catch(() => null);
  await page.getByTestId('code/openInVsCode').click();
  await popup;
  const opened = await (await request.get('http://127.0.0.1:4799/__vscode')).json();
  expect(opened.at(-1)).toEqual({ path: 'src/devices/DeviceList.tsx', line: 1 });
});

test('dark theme applies tokens', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'dark' }); const page = await ctx.newPage();
  await page.goto('/');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toBe('#0F1217');
  await ctx.close();
});
