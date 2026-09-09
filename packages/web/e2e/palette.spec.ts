import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });
test('⌘K fuzzy-finds changed files first and opens on Enter', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible(); await page.keyboard.press('Control+k');
  const pal = page.getByTestId('filePalette'); await expect(pal).toBeVisible();
  await pal.getByTestId('filePalette/input').fill('devl');
  await expect(pal.getByTestId(/^filePalette\/row\/[^/]+$/).first()).toContainText('DeviceList.tsx');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('code/path')).toHaveText('src/devices/DeviceList.tsx');
  await expect(pal).toHaveCount(0);
});
test('unchanged files open as plain file view at head with "not in PR" label', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible(); await page.keyboard.press('Control+k');
  await page.getByTestId('filePalette/input').fill('de.json'); // changed → diff
  const changedRow = page.getByTestId(/^filePalette\/row\/[^/]+$/).first();
  await expect(changedRow).toContainText('src/i18n/de.json');
  await expect(changedRow).not.toContainText('not in PR');
  await page.keyboard.press('Enter'); await expect(page.getByTestId('code/diff')).toBeVisible();
  await page.keyboard.press('Control+k'); await page.getByTestId('filePalette/input').fill('index.ts');
  await expect(page.getByTestId(/^filePalette\/row\/[^/]+$/).first()).toContainText('not in PR');
  await page.keyboard.press('Enter'); await expect(page.getByTestId('code/file')).toBeVisible();
  await expect(page.getByTestId('code/path')).toHaveText('src/index.ts');
  await page.getByTestId('files/modeAll').click();
  // tree at head: 6 changed survivors + src/index.ts (deleted file not in tree) + docs/RELEASE_NOTES.md
  // (present since main, never touched by the feature branch — so it doesn't count as "changed").
  await expect(page.getByTestId(/^files\/file\/[^/]+$/)).toHaveCount(8);
});
test('commit picker shows the file at an older commit', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  const picker = page.getByTestId('code/atPicker');
  const options = await picker.locator('option').allTextContents();
  await picker.selectOption({ label: options.find(o => o.includes('wire windowed rows'))! });
  await expect(page.getByTestId('code/file')).toBeVisible();
  await expect(page.getByTestId('code/row/new/14')).toContainText('items.map');
  await picker.selectOption({ label: 'file at merge-base' });
  await expect(page.getByTestId('code/row/new/3')).toContainText('useIntersection');
  await picker.selectOption({ label: 'diff' }); await expect(page.getByTestId('code/diff')).toBeVisible();
});
