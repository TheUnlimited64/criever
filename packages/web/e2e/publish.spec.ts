import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });
async function draft(page: import('@playwright/test').Page, file: string, line: number, text: string) {
  await page.getByTestId(`files/file/${file}`).click();
  await page.getByTestId(`code/row/new/${line}/gutter`).click();
  await page.getByTestId('composer/text').fill(text); await page.getByTestId('composer/save').click();
}
test('publishes all drafts in order and clears them', async ({ page, request }) => {
  await page.goto('/');
  await draft(page, 'src%2Fdevices%2FuseDeviceRows.ts', 8, 'first');
  await draft(page, 'src%2Fdevices%2FuseDeviceRows.ts', 9, 'second');
  await page.getByTestId('header/publishButton').click();
  const sheet = page.getByTestId('publishSheet'); await expect(sheet).toContainText('Publish 2 drafts');
  await expect(sheet.getByTestId(/publishSheet\/row\/[^/]+$/)).toHaveCount(2);
  await sheet.getByTestId('publishSheet/confirm').click();
  await expect(page.getByTestId('toast')).toContainText('Published 2');
  await expect(page.getByTestId('header/draftCount')).toContainText('0 drafts');
  const rec = await (await request.get('http://127.0.0.1:4799/__stub/recorded')).json();
  expect(rec.map((r: { content: { raw: string } }) => r.content.raw)).toEqual(['first', 'second']);
  expect(rec[0].inline).toEqual({ path: 'src/devices/useDeviceRows.ts', to: 8 });
  // the published comments now show as threads authored by me
  await expect(page.getByTestId('comments/group/open/count')).toHaveText('5');
});
test('stops at the failing draft, keeps it and later ones', async ({ page }) => {
  await page.goto('/');
  await draft(page, 'src%2Fdevices%2FuseDeviceRows.ts', 5, 'ok one');
  await draft(page, 'src%2Fdevices%2FuseDeviceRows.ts', 6, 'FAIL_ME please');
  await draft(page, 'src%2Fdevices%2FuseDeviceRows.ts', 7, 'never sent');
  await page.getByTestId('header/publishButton').click();
  await page.getByTestId('publishSheet/confirm').click();
  const sheet = page.getByTestId('publishSheet');
  await expect(sheet.locator('.sheet-row.ok')).toHaveCount(1);
  await expect(sheet.locator('.sheet-row.failed')).toHaveCount(1);
  await expect(sheet.locator('.sheet-row.failed')).toContainText('Comment rejected by stub');
  await sheet.getByTestId('publishSheet/cancel').click();
  await expect(page.getByTestId('header/draftCount')).toContainText('2 drafts');
});
test('remove a draft from the sheet', async ({ page }) => {
  await page.goto('/'); await draft(page, 'src%2Fdevices%2FuseDeviceRows.ts', 8, 'x');
  await page.getByTestId('header/publishButton').click();
  await page.getByTestId(/publishSheet\/row\/[^/]+\/remove$/).click();
  await expect(page.getByTestId('publishSheet')).toContainText('Nothing to publish');
});
