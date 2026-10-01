import { expect, test } from '@playwright/test';
import type { WorkspaceProject, WorkspaceSnapshot } from '@criever/shared';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__reset')).ok()).toBe(true);
});

test('adds a project, filters assignments, confirms checkout and reviews in the existing workspace', async ({ page, request }) => {
  const fixture: { path: string } = await (await request.get('/__fixture')).json();
  await page.goto('/');
  await page.getByTestId('workspace/add-project').click();
  await page.getByTestId('workspace/project-path').fill(fixture.path);
  const added = page.waitForResponse(response => response.url().endsWith('/api/workspace/projects') && response.request().method() === 'POST');
  await page.getByTestId('workspace/project-submit').click();
  expect((await added).ok()).toBe(true);
  const snapshot: WorkspaceSnapshot = await (await request.get('/api/workspace')).json();
  const project = snapshot.projects[0];
  expect(project).toBeDefined();
  if (!project) throw new Error('Project was not added');
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByTestId('pr/241/open')).toBeVisible();
  await expect(page.getByTestId('pr/242/open')).toBeVisible();
  await page.getByTestId('workspace/assigned').click();
  await expect(page.getByTestId('pr/242/open')).toHaveCount(0);
  await page.getByTestId('pr/241/open').click();
  await page.getByTestId('workspace/checkout-cancel').click();
  expect((await (await request.get('/__fixture')).json()).checkoutCount).toBe(0);
  await page.getByTestId('pr/241/open').click();
  await page.getByTestId('workspace/checkout-confirm').click();
  await expect(page).toHaveURL(/\/review\/[^/]+\//);
  await expect(page.getByTestId('header/overviewButton')).toBeVisible();
  await expect(page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx')).toBeVisible();
  await page.getByTestId('files/file/src%2Fdevices%2FDeviceList.tsx').click();
  await expect(page.locator('table.diff')).toBeVisible();
  await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('code/row/new/8/gutter').click();
  await page.getByTestId('composer/text').fill('Finding from the daemon review workspace');
  await page.getByTestId('composer/save').click();
  await page.getByTestId('header/publishButton').click();
  await page.getByTestId('publishSheet/confirm').click();
  await expect(page.getByTestId('toast')).toContainText('Published 1');
  await expect(page.getByTestId('header/draftCount')).toContainText('0 drafts');
  const marked = page.waitForResponse(response => response.url().endsWith(`/projects/${project.id}/prs/241/reviewed`) && response.request().method() === 'POST');
  await page.getByTestId('workspace/session-reviewed').click();
  expect((await marked).ok()).toBe(true);
  await expect(page.getByTestId('workspace/session-reviewed')).toBeDisabled();
  await page.getByTestId('workspace/back-project').click();
  await expect(page).toHaveURL(`/projects/${project.id}`);
  const reviewed: WorkspaceSnapshot = await (await request.get('/api/workspace')).json();
  expect(reviewed.projects[0]?.pullRequests.find(pr => pr.id === 241)?.status).toBe('reviewed');
});

test('surfaces new revisions on Projects without treating a failed refresh as current', async ({ page, request }) => {
  const fixture: { path: string; firstHead: string } = await (await request.get('/__fixture')).json();
  const project: WorkspaceProject = await (await request.post('/api/workspace/projects', { data: { path: fixture.path } })).json();
  expect((await request.post(`/api/workspace/projects/${project.id}/prs/241/reviewed`, { data: { sourceHead: fixture.firstHead } })).ok()).toBe(true);
  await request.post('/__advance');
  await page.goto('/');
  await page.getByTestId('workspace/refresh').click();
  await expect(page.getByTestId('workspace/updates')).toContainText('feat(catalog): virtualize item list');
  await request.post('/__fail');
  await page.getByTestId('workspace/refresh').click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByTestId('workspace/updates')).toContainText('feat(catalog): virtualize item list');
});

test('keeps project navigation and checkout confirmation usable on a narrow viewport', async ({ page, request }) => {
  const fixture: { path: string } = await (await request.get('/__fixture')).json();
  const project: WorkspaceProject = await (await request.post('/api/workspace/projects', { data: { path: fixture.path } })).json();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/projects/${project.id}`);
  await page.getByTestId('pr/241/open').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await (await request.get('/__fixture')).json()).checkoutCount).toBe(0);
});

test('explains expired review sessions instead of mounting an empty review', async ({ page }) => {
  await page.goto('/review/missing-session/');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('link', { name: /projects/i })).toBeVisible();
  await expect(page.getByTestId('header/overviewButton')).toHaveCount(0);
});
