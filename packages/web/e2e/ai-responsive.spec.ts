import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request, baseURL }) => { await request.post(`${baseURL}/__reset`); });

test('the line composer can switch between comment and AI on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const lineAction = page.getByTestId('code/row/new/2').locator('button.gutter-action.context');
  await expect(lineAction).toHaveAccessibleName('Comment or ask AI about line 2');
  await expect(lineAction).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('phone-line-action.png') });
  const unified = page.getByTestId('code/modeUnified');
  expect(await unified.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByTestId('code/row/new/3/gutter').first().click();
  const action = page.getByRole('button', { name: 'Ask AI privately' });
  await expect(action).toBeVisible();
  await action.click();
  await expect(page.getByRole('textbox', { name: 'Private question' })).toBeVisible();
  const questionBounds = await page.getByRole('textbox', { name: 'Private question' }).boundingBox();
  expect(questionBounds && questionBounds.x + questionBounds.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath('phone-line-composer.png') });
  await page.getByRole('button', { name: 'PR comment' }).click();
  await expect(page.getByTestId('composer')).toBeVisible();
});

test('AI rail stays within narrow, tablet, and desktop viewports', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
    await expect(page.getByLabel('AI harness')).toBeVisible();
    await expect(page.getByLabel('General question')).toBeVisible();
    const bounds = await page.getByTestId('ai-rail').boundingBox();
    expect(bounds && bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`ai-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Close AI chat' }).click();
  }
});

test('footer shortcuts stay on one line and the source is reachable on phone and tablet', async ({ page }, testInfo) => {
  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click();
    const footer = page.getByTestId('footer');
    const bounds = await footer.boundingBox();
    const source = page.getByTestId('footer/head');
    await page.screenshot({ path: testInfo.outputPath(`footer-${width}.png`) });
    await footer.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect(source).toBeInViewport();
    const sourceBounds = await source.boundingBox();
    expect(bounds && sourceBounds && sourceBounds.y + sourceBounds.height).toBeLessThanOrEqual(800);
  }
});

test('code keeps the workspace height and AI opens across the daemon layout breakpoints', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const width of [375, 600, 768, 1001, 1100, 1199, 1200, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const main = page.locator('.main');
    const code = page.getByTestId('code');
    await expect(code).toBeVisible();
    const workspaceBounds = await main.boundingBox();
    const codeBounds = await code.boundingBox();
    expect(codeBounds!.height).toBeGreaterThan(workspaceBounds!.height - 2);
    const toggle = page.getByRole('navigation', { name: 'Review tools' }).getByRole('button', { name: 'AI', exact: true });
    await toggle.click();
    const rail = page.getByTestId('ai-rail');
    await expect(rail).toBeVisible();
    const bounds = await rail.boundingBox();
    expect(bounds!.height).toBeGreaterThan(workspaceBounds!.height - 2);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: testInfo.outputPath(`workspace-ai-${width}.png`) });
    await page.getByRole('button', { name: 'Close AI chat' }).click();
    await expect(code).toBeVisible();
  }
});

test('desktop AI control belongs to the review toolbar in dark mode', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 2048, height: 1086 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByTestId('files/file/package.json').click();
  const toolbar = page.getByRole('navigation', { name: 'Review tools' });
  const ai = toolbar.getByRole('button', { name: 'AI', exact: true });
  await expect(ai).toBeVisible();
  expect((await ai.boundingBox())!.x).toBeGreaterThan(1024);
  await page.screenshot({ path: testInfo.outputPath('desktop-dark.png'), fullPage: true });
  await ai.click();
  await expect(page.getByTestId('ai-rail')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-dark-ai.png'), fullPage: true });
});
