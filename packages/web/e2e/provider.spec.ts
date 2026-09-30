import { test, expect } from '@playwright/test';
import type { CommentsResponse, PrInfo } from '@criever/shared';

test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4799/__reset'); });

for (const provider of [
  { kind: 'github', name: 'GitHub', url: 'https://github.com/acme/catalog/pull/241' },
  { kind: 'bitbucket', name: 'Bitbucket', url: 'https://bitbucket.org/acme/catalog/pull-requests/241' },
] as const) {
  test(`${provider.name} repository identity and review actions`, async ({ page, request }) => {
    const pr: PrInfo = await (await request.get('http://127.0.0.1:4799/api/pr')).json();
    await page.route('**/api/pr', route => route.fulfill({ json: { ...pr, kind: provider.kind, url: provider.url } }));
    await page.goto('/');
    await expect(page.getByTestId('header/repo')).toHaveText('acme / catalog');
    await expect(page.locator('.workspace-kind')).toHaveText(`${provider.name} review`);
    await expect(page.getByTestId('header/publishButton')).toHaveAttribute('title', `Review drafts before publishing to ${provider.name}`);
    await page.getByTestId('header/overviewButton').click();
    await expect(page.getByTestId('overview/link')).toHaveText(`Open in ${provider.name} ↗`);
    await expect(page.getByTestId('overview/link')).toHaveAttribute('href', provider.url);
    await page.getByTestId('overview/done').click();
    await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
    await page.getByTestId('code/row/new/8/gutter').click();
    await expect(page.getByTestId('composer/text')).toHaveAttribute('placeholder', `Comment on line 8. Markdown, rendered by ${provider.name}.`);
    await page.getByTestId('composer/text').fill('Check this condition');
    await page.getByTestId('composer/save').click();
    await page.getByTestId('header/publishButton').click();
    if (provider.kind === 'github') {
      await expect(page.getByTestId('publishSheet').locator('.sub')).toHaveText('Root comments in one COMMENT review batch; replies published separately.');
    }
    await page.getByTestId('publishSheet/cancel').click();
    await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
    await page.getByTestId('thread/301/resolve').click();
    await expect(page.getByTestId('toast')).toHaveText(`Resolved on ${provider.name}`);
    await page.unrouteAll({ behavior: 'wait' });
  });
}

test('non-resolvable comments keep replies but reject resolve buttons and shortcuts', async ({ page, request }) => {
  const comments: CommentsResponse = await (await request.get('http://127.0.0.1:4799/api/comments')).json();
  await page.route('**/api/comments', route => route.fulfill({
    json: { ...comments, threads: comments.threads.map(thread => ({ ...thread, root: { ...thread.root, canResolve: false } })) },
  }));
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (/\/api\/comments\/\d+\/resolve$/.test(url)) document.documentElement.dataset.resolveCalls = 'called';
      return original(input, init);
    };
  });
  await page.goto('/');
  await expect(page.getByTestId('comments')).toBeVisible();
  await expect(page.getByTestId(/^thread\/\d+\/resolve$/)).toHaveCount(0);
  await expect(page.getByTestId(/^thread\/\d+\/reply$/).first()).toBeVisible();
  await page.getByTestId('comments/item/301').click();
  await expect(page.getByTestId('thread/301')).toHaveClass(/focused/);
  await expect(page.getByTestId('thread/301/resolve')).toHaveCount(0);
  await page.keyboard.press('r');
  expect(await page.evaluate(() => document.documentElement.dataset.resolveCalls)).toBeUndefined();
  await page.unrouteAll({ behavior: 'wait' });
});

test('read-only conversation comments expose no unsupported reply actions', async ({ page, request }) => {
  const comments: CommentsResponse = await (await request.get('http://127.0.0.1:4799/api/comments')).json();
  await page.route('**/api/comments', route => route.fulfill({
    json: { ...comments, threads: comments.threads.map(thread => ({ ...thread, root: { ...thread.root, canResolve: false, canReply: false } })) },
  }));
  await page.goto('/');
  await expect(page.getByTestId('comments')).toBeVisible();
  await page.getByTestId('comments/item/301').click();
  await expect(page.getByTestId('thread/301')).toBeVisible();
  await expect(page.getByTestId(/^thread\/\d+\/reply$/)).toHaveCount(0);
  await expect(page.getByTestId(/^thread\/\d+\/resolve$/)).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
});

test('file-level GitHub threads remain reachable and support reply drafts', async ({ page }) => {
  await page.route('**/api/comments', async route => {
    const comments: CommentsResponse = await (await route.fetch()).json();
    await route.fulfill({ json: { ...comments, threads: comments.threads.map(thread => thread.root.id === 301
      ? { ...thread, root: { ...thread.root, inline: null, filePath: thread.displayPath }, anchor: null, status: null, displayLine: null }
      : thread) } });
  });
  await page.goto('/');
  await page.getByTestId('comments/item/301').click();
  await expect(page.getByTestId('code/unanchored')).toBeVisible();
  await expect(page.getByTestId('thread/301')).toBeVisible();
  await page.getByTestId('thread/301/reply').click();
  await page.getByTestId('composer/text').fill('Reply to the file-level review');
  await page.getByTestId('composer/save').click();
  await expect(page.getByTestId('thread/301').locator('.draft-reply')).toContainText('Reply to the file-level review');
  await page.unrouteAll({ behavior: 'wait' });
});
