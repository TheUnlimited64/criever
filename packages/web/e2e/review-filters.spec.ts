import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { WorkspaceProject, WorkspaceSnapshot } from '@criever/shared';

// Synthetic review activity served by the daemon fixture in place of the default comments.
const me = { display_name: 'Example Me', uuid: '{viewer}' };
const reviewer = { display_name: 'Example Reviewer', uuid: '{reviewer}' };
const comment = (id: number, user: typeof me, created_on: string, extra: object = {}) =>
  ({ id, created_on, deleted: false, user, content: { raw: 'synthetic text' }, ...extra });
const mine = comment(1, me, '2026-09-03T10:00:00Z');
const reply = comment(2, reviewer, '2026-09-04T10:00:00Z', { parent: { id: 1 } });
const independent = comment(3, reviewer, '2026-09-04T11:00:00Z');

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__reset')).ok()).toBe(true);
});

const scenario = (request: APIRequestContext, data: object) => request.post('/__scenario', { data });
async function open(page: Page, request: APIRequestContext) {
  const fixture: { path: string } = await (await request.get('/__fixture')).json();
  const project: WorkspaceProject = await (await request.post('/api/workspace/projects', { data: { path: fixture.path } })).json();
  await page.goto(`/projects/${project.id}`);
  return project;
}
const rows = async (page: Page) => (await page.locator('[data-testid^="pr/"][data-testid$="/open"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')))).sort();

test('filters assigned, pending and recheck pull requests with matching explanations', async ({ page, request }) => {
  await scenario(request, { 241: { comments: [mine, reply] }, 242: { assigned: true } });
  await open(page, request);
  const count = (name: string) => page.getByTestId(`workspace/summary-${name}`).locator('strong');
  await expect(count('all')).toHaveText('2');
  await expect(count('assigned')).toHaveText('2');
  await expect(count('pending')).toHaveText('1');
  await expect(count('updates')).toHaveText('1');

  await page.getByTestId('workspace/filter/pending').click();
  expect(await rows(page)).toEqual(['pr/242/open']);
  await page.getByTestId('workspace/assigned').click();
  expect(await rows(page)).toEqual(['pr/241/open', 'pr/242/open']);
  await page.getByTestId('workspace/filter/updated').click();
  expect(await rows(page)).toEqual(['pr/241/open']);

  const reasons = page.getByTestId('pr/241/recheck');
  await expect(reasons).toContainText('Since your review: Reply in a thread you joined.');
  await expect(reasons).toContainText('Example Reviewer');
  await expect(reasons).not.toContainText('commits changed');
  await expect(page.getByTestId('pr/241/recheck/comment')).toHaveCount(0);
  await expect(page.getByTestId('pr/241/status')).toHaveText('Needs recheck');
});

test('shows separate comments, and code and discussion reasons together', async ({ page, request }) => {
  await scenario(request, { 241: { comments: [mine, independent] } });
  await open(page, request);
  await page.getByTestId('workspace/filter/updated').click();
  const reasons = page.getByTestId('pr/241/recheck');
  await expect(reasons).toContainText('Since your review: New comment by Example Reviewer.');
  await expect(reasons).not.toContainText('Reply in a thread');
  await expect(page.getByTestId('pr/241/recheck/commits')).toHaveCount(0);

  await request.post('/__advance');
  await page.getByTestId('workspace/refresh').click();
  await expect(page.getByTestId('pr/241/recheck/commits')).toHaveText('Since your review: PR commits changed.');
  await expect(page.getByTestId('pr/241/recheck/comment')).toBeVisible();
});

test('acknowledges locally from the list, re-flags new discussion and clears back', async ({ page, request }) => {
  await scenario(request, { 241: { comments: [mine, independent] } });
  await open(page, request);
  await page.getByTestId('workspace/filter/updated').click();
  await page.getByTestId('pr/241/reviewed').click();
  await expect(page.getByTestId('workspace/updates')).not.toContainText('feat(catalog)');
  await page.getByTestId('workspace/filter/all').click();
  await expect(page.getByTestId('pr/241/status')).toHaveText('Reviewed');
  await expect(page.getByTestId('pr/241/reviewed')).toHaveText('Clear reviewed');

  await scenario(request, { 241: { comments: [mine, independent, comment(4, reviewer, '2099-01-01T00:00:00Z')] } });
  await page.getByTestId('workspace/refresh').click();
  await expect(page.getByTestId('pr/241/status')).toHaveText('Needs recheck');
  await expect(page.getByTestId('pr/241/reviewed')).toHaveText('Mark reviewed');
  await expect(page.getByTestId('pr/241/recheck/commits')).toHaveCount(0);

  await page.getByTestId('pr/241/clear-reviewed').click();
  // Provider activity remains: the user's own comment is the baseline again.
  await expect(page.getByTestId('pr/241/clear-reviewed')).toHaveCount(0);
  await expect(page.getByTestId('pr/241/recheck/comment')).toContainText('New comment');
  const snapshot: WorkspaceSnapshot = await (await request.get('/api/workspace')).json();
  expect(snapshot.projects[0]!.pullRequests.find(pr => pr.id === 241)!.reviewedHead).toBeNull();
});

test('acknowledges from a review session and allows another acknowledgement after new discussion', async ({ page, request }) => {
  await scenario(request, { 241: { comments: [mine, independent] } });
  await open(page, request);
  await page.getByTestId('pr/241/open').click();
  await page.getByTestId('workspace/checkout-confirm').click();
  await expect(page).toHaveURL(/\/review\/[^/]+\//);
  await expect(page.getByTestId('workspace/session-recheck')).toContainText('Since your review: New comment by Example Reviewer.');
  await page.getByTestId('workspace/session-reviewed').click();
  await expect(page.getByTestId('workspace/session-reviewed')).toBeDisabled();
  await expect(page.getByTestId('workspace/session-recheck')).toBeEmpty();
  const snapshot: WorkspaceSnapshot = await (await request.get('/api/workspace')).json();
  expect(snapshot.projects[0]!.pullRequests.find(pr => pr.id === 241)!.status).toBe('reviewed');

  await scenario(request, { 241: { comments: [mine, independent, comment(4, reviewer, '2099-01-01T00:00:00Z')] } });
  await request.post(`/api/workspace/projects/${snapshot.projects[0]!.id}/refresh`);
  await page.reload();
  await expect(page.getByTestId('workspace/session-recheck')).toContainText('Since your review');
  await expect(page.getByTestId('workspace/session-reviewed')).toBeEnabled();
});

test('keeps flagged cards readable and within the viewport on a narrow screen', async ({ page, request }) => {
  await scenario(request, { 241: { comments: [mine, reply, independent] }, 242: { assigned: true } });
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, request);
  await page.getByTestId('workspace/filter/updated').click();
  await expect(page.getByTestId('pr/241/recheck')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const card = await page.getByTestId('pr/241').boundingBox();
  const reasons = await page.getByTestId('pr/241/recheck').boundingBox();
  expect(reasons!.x).toBeGreaterThanOrEqual(card!.x);
  expect(reasons!.x + reasons!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
  for (const id of ['workspace/filter/all', 'workspace/assigned', 'workspace/filter/pending', 'workspace/filter/updated', 'pr/241/reviewed']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(376);
    expect(box!.height).toBeGreaterThanOrEqual(24);
  }
  await page.getByTestId('workspace/summary-pending').click();
  await expect(page.getByTestId('pr/242')).toBeVisible();
});
