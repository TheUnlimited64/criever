import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });
test('? opens keymap, Esc closes; ] [ switch files; v toggles viewed', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  await page.keyboard.press('Shift+?'); await expect(page.getByTestId('keymap')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByTestId('keymap')).toHaveCount(0);
  await page.keyboard.press(']'); await expect(page.getByTestId('code/path')).not.toHaveText('src/devices/DeviceList.tsx');
  await page.keyboard.press('['); await expect(page.getByTestId('code/path')).toHaveText('src/devices/DeviceList.tsx');
  await page.keyboard.press('v'); await expect(page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx/viewed')).toHaveClass(/on/);
  await page.keyboard.press('v'); await expect(page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx/viewed')).not.toHaveClass(/on/);
});
test('j moves the cursor to the next hunk, c opens the composer there, n focuses next thread, r resolves it', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  await page.keyboard.press('j'); await expect(page.locator('tr.cursor')).toHaveCount(1);
  await page.keyboard.press('c'); await expect(page.getByTestId('composer')).toBeVisible(); await page.keyboard.press('Escape');
  await page.keyboard.press('n'); await expect(page.locator('.card.focused')).toHaveCount(1);
  await page.keyboard.press('r'); await expect(page.locator('.card.focused .chip')).toHaveText('resolved');
});
test('ArrowDown/ArrowUp move the cursor line by line and c comments at the cursor; arrows in filter do not move the cursor', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('files/filter').fill('x'); await page.getByTestId('files/filter').press('ArrowDown');
  await expect(page.locator('tr.cursor')).toHaveCount(0);
  await page.getByTestId('files/filter').fill(''); await page.getByTestId('files/filter').blur();

  await page.keyboard.press('ArrowDown'); await expect(page.locator('tr.cursor')).toHaveCount(1);
  const first = await page.locator('tr.cursor').getAttribute('data-testid');
  await page.keyboard.press('ArrowDown'); await expect(page.locator('tr.cursor')).toHaveCount(1);
  const second = await page.locator('tr.cursor').getAttribute('data-testid');
  expect(second).not.toBe(first);
  await page.keyboard.press('ArrowUp'); await expect(page.locator('tr.cursor')).toHaveAttribute('data-testid', first!);

  await page.keyboard.press('c'); await expect(page.getByTestId('composer')).toBeVisible();
  const cursorRowTestId = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table.diff tbody > tr')];
    const idx = rows.findIndex(r => r.querySelector('[data-testid="composer"]'));
    return rows[idx - 1]?.getAttribute('data-testid') ?? null;
  });
  expect(cursorRowTestId).toBe(first);
  await page.keyboard.press('Escape');
});
test('. asks the server to open VS Code at the cursor line', async ({ page, request }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('code/row/new/8/gutter').click(); await page.keyboard.press('Escape');
  const popup = page.waitForEvent('popup').catch(() => null);
  await page.keyboard.press('.'); await popup;
  const opened = await (await request.get('http://127.0.0.1:4799/__vscode')).json();
  expect(opened.at(-1)).toEqual({ path: 'src/devices/useDeviceRows.ts', line: 8 });
});
