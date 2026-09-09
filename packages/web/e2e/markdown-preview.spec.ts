import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });

test('toggling a markdown file to preview renders it, toggling back shows source rows', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/modeAll').click();
  await page.getByTestId('files/file/docs%2FRELEASE_NOTES.md').click();
  await expect(page.getByTestId('code/file')).toBeVisible();
  await expect(page.getByTestId('code/modePreview')).toBeVisible();
  await page.getByTestId('code/modePreview').click();
  const preview = page.getByTestId('code/preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('h1')).toHaveText('Release Notes');
  await expect(preview.locator('li')).toHaveCount(2);
  await expect(page.getByTestId('code/file')).toBeHidden();
  await page.getByTestId('code/modeSource').click();
  await expect(page.getByTestId('code/file')).toBeVisible();
  await expect(page.getByTestId('code/preview')).toHaveCount(0);
});

test('the source | preview toggle only appears for markdown files', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  await expect(page.getByTestId('code/modePreview')).toHaveCount(0);
});
