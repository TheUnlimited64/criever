import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });
test('repo search lists git grep hits and jumps to file:line', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible(); await page.keyboard.press('Control+Shift+F');
  await page.getByTestId('repoSearch/input').fill('estimateSize');
  const hit = page.getByTestId('repoSearch/hit/0'); await expect(hit).toContainText('useDeviceRows.ts'); await expect(hit).toContainText(':8');
  await hit.click();
  await expect(page.getByTestId('code/path')).toHaveText('src/devices/useDeviceRows.ts');
  await expect(page.getByTestId('code/file')).toBeVisible();
  await expect(page.getByTestId('code/row/new/8')).toHaveClass(/cursor/);
});
test('find in file highlights and steps through matches', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  await page.keyboard.press('Control+f');
  await page.getByTestId('findBar/input').fill('DeviceRow');
  await expect(page.getByTestId('findBar/count')).toContainText('1 of');
  await expect(page.locator('tr.find-hit')).not.toHaveCount(0);
  await page.getByTestId('findBar/input').press('Enter');
  await expect(page.getByTestId('findBar/count')).toContainText('2 of');
  await page.keyboard.press('Escape'); await expect(page.getByTestId('findBar')).toHaveCount(0);
});
