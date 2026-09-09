import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });

test('add, edit, delete a draft via the gutter', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('code/row/new/8/gutter').click();
  const composer = page.getByTestId('composer'); await expect(composer).toBeVisible();
  await composer.getByTestId('composer/text').fill('estimateSize should come from the design token, not a literal 36.');
  await composer.getByTestId('composer/save').click();
  const card = page.getByTestId(/^draft\/[0-9a-f-]+$/).first();
  await expect(card).toContainText('design token'); await expect(card).toHaveClass(/draft/);
  await expect(page.getByTestId('header/draftCount')).toContainText('1 draft');
  await expect(page.getByTestId('comments/group/drafts/count')).toHaveText('1');
  await expect(page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').locator('.pip.draft')).toBeVisible();
  // edit
  await card.getByTestId(/\/edit$/).click();
  await page.getByTestId('composer/text').fill('edited body'); await page.getByTestId('composer/save').click();
  await expect(card).toContainText('edited body');
  // delete
  await card.getByTestId(/\/delete$/).click();
  await expect(page.getByTestId(/^draft\//)).toHaveCount(0);
  await expect(page.getByTestId('header/draftCount')).toContainText('0 drafts');
});
test('ctrl+enter saves, escape cancels, comment on a removed (old-side) line', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  await page.getByTestId('code/row/old/3/gutter').click();
  await page.getByTestId('composer/text').press('Escape'); await expect(page.getByTestId('composer')).toHaveCount(0);
  await page.getByTestId('code/row/old/3/gutter').click();
  await page.getByTestId('composer/text').fill('why remove this?'); await page.getByTestId('composer/text').press('Control+Enter');
  const card = page.getByTestId(/^draft\//).first(); await expect(card).toContainText('why remove this?');
  const rows = page.locator('table.diff tbody > tr');
  const idx = await rows.evaluateAll(trs => trs.findIndex(tr => tr.querySelector('[data-testid^="draft/"]')));
  expect(await rows.nth(idx - 1).getAttribute('data-testid')).toBe('code/row/old/3');
});
test('shift+click selects a range; composer sits at the last line', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('code/row/new/5/gutter').click();
  await page.getByTestId('code/row/new/8/gutter').click({ modifiers: ['Shift'] });
  await expect(page.locator('tr.sel')).toHaveCount(4);
  await expect(page.getByTestId('composer')).toContainText('lines 5–8');
});
test('gutter and range selection work in split view too', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('code/modeSplit').click();
  await page.getByTestId('code/row/new/5/gutter').click();
  await page.getByTestId('code/row/new/8/gutter').click({ modifiers: ['Shift'] });
  await expect(page.locator('tr.sel')).toHaveCount(4);
  await expect(page.getByTestId('composer')).toContainText('lines 5–8');
  await page.getByTestId('code/modeUnified').click();   // leave the toggle as it was
});
test('composer write/preview toggle renders markdown and saves the raw source', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('code/row/new/8/gutter').click();
  const composer = page.getByTestId('composer'); await expect(composer).toBeVisible();
  const source = '**bold** text\n- list item';
  await composer.getByTestId('composer/text').fill(source);
  await composer.getByTestId('composer/modePreview').click();
  const preview = composer.getByTestId('composer/preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('strong')).toHaveCount(1);
  await expect(preview.locator('li')).toHaveCount(1);
  await composer.getByTestId('composer/modeWrite').click();
  await expect(composer.getByTestId('composer/text')).toHaveValue(source);
  await composer.getByTestId('composer/modePreview').click();
  await composer.getByTestId('composer/save').click();
  const card = page.getByTestId(/^draft\/[0-9a-f-]+$/).first();
  await expect(card.locator('strong')).toHaveText('bold');
  await expect(card.locator('li')).toHaveText('list item');
});
test('composer preview warns about a task list that will not render on Bitbucket', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('code/row/new/8/gutter').click();
  const composer = page.getByTestId('composer');
  await composer.getByTestId('composer/text').fill('- [ ] fix this later');
  await composer.getByTestId('composer/modePreview').click();
  await expect(composer.getByTestId('composer/previewWarning')).toContainText(/task list/i);
  await composer.getByTestId('composer/cancel').click();
});
test('formatting toolbar wraps the selection in bold and toggles it back off on a second click', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('code/row/new/8/gutter').click();
  const composer = page.getByTestId('composer'); const text = composer.getByTestId('composer/text');
  await text.fill('hello world'); await text.selectText();
  await composer.getByTestId('composer/fmt/bold').click();
  await expect(text).toHaveValue('**hello world**');
  await composer.getByTestId('composer/fmt/bold').click();
  await expect(text).toHaveValue('hello world');
  await composer.getByTestId('composer/cancel').click();
});
test('⌘/Ctrl+B applies bold from the keyboard while the composer textarea is focused', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('code/row/new/8/gutter').click();
  const composer = page.getByTestId('composer'); const text = composer.getByTestId('composer/text');
  await text.fill('hello world'); await text.selectText();
  await page.keyboard.press('Control+b');
  await expect(text).toHaveValue('**hello world**');
  await composer.getByTestId('composer/cancel').click();
});
test('⌘/Ctrl+K inside the composer inserts a link and does not open the file palette', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('code/row/new/8/gutter').click();
  const composer = page.getByTestId('composer'); const text = composer.getByTestId('composer/text');
  await text.fill('see docs'); await text.selectText();
  await page.keyboard.press('Control+k');
  await expect(text).toHaveValue('[see docs]()');
  await expect(page.getByTestId('filePalette')).toHaveCount(0);
  await composer.getByTestId('composer/cancel').click();
});
