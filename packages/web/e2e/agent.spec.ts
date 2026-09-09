import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:4801/__reset'); });

test('header shows the local-review label and a Save button', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await expect(page.getByTestId('header/title')).toContainText('local review ·');
  await expect(page.getByTestId('header/repo')).toHaveCount(0);
  await expect(page.getByTestId('header/prNumber')).toHaveCount(0);
  await expect(page.getByTestId('header/newCommitsBanner')).toHaveCount(0);
  await expect(page.getByTestId('header/publishButton')).toHaveText('Save');
});

test('an agent comment renders with a badge and agent name', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  const card = page.getByTestId('thread/1');
  await expect(card.getByTestId('thread/1/agentBadge')).toHaveText('agent');
  await expect(card).toContainText('coding-agent');   // the name appears once, on the author line
  await expect(card).toContainText('memoizing');
});

test('the rail counts agent comments in their own group, with their own avatar treatment', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await expect(page.getByTestId('comments/group/agent/count')).toHaveText('2');
  const agentItem = page.getByTestId('comments/group/agent').getByTestId(/^comments\/item\/\d+$/).first();
  await expect(agentItem.locator('.avatar')).toHaveClass(/agent/);
});

test('a human reply to an agent comment saves as a draft', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  const card = page.getByTestId('thread/1');
  await card.getByTestId('thread/1/reply').click();
  await card.getByTestId('composer/text').fill('Good catch, memoizing in the next push.');
  await card.getByTestId('composer/save').click();
  await expect(card.getByTestId(/^thread\/1\/draftReply\/[^/]+$/)).toContainText('memoizing in the next push');
  await expect(page.getByTestId('header/draftCount')).toContainText('1 draft');
});

test('the overview degrades honestly for a local review: no description, still a commit list', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('files/count')).toBeVisible();
  await page.keyboard.press('o');
  await expect(page.getByTestId('overview')).toBeVisible();
  await expect(page.getByTestId('overview/description')).toHaveCount(0);
  await expect(page.getByTestId('overview/noDescription')).toContainText('no pull request');
  await expect(page.getByTestId('overview/link')).toHaveCount(0);          // nowhere to link to
  await expect(page.getByTestId('overview/commits').getByRole('button')).toHaveCount(3);
  await page.getByTestId('overview/commits').getByRole('button').nth(1).click(); // not the head commit
  await expect(page.getByTestId('header/rangeChip')).toContainText('read-only');
});
