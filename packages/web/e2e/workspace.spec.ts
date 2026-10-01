import { expect, test } from '@playwright/test';
import type { WorkspaceProject, WorkspaceSession, WorkspaceSnapshot } from '@criever/shared';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__reset')).ok()).toBe(true);
});

test('completes partial folder paths with keyboard and pointer selection', async ({ page, request }) => {
  const fixture: { path: string } = await (await request.get('/__fixture')).json();
  await page.goto('/');
  await page.getByTestId('workspace/add-project').click();
  const input = page.getByRole('combobox', { name: 'Local repository path' });
  await input.fill('~/rev');
  await expect(page.getByRole('option', { name: /review-fixture/ })).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue(`${fixture.path}/`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await input.fill(`${fixture.path}/s`);
  await page.getByRole('option', { name: /^src/ }).click();
  await expect(input).toHaveValue(`${fixture.path}/src/`);
  await expect(input).toBeFocused();
  await input.fill('~/rev');
  await expect(page.getByRole('option', { name: /review-fixture/ })).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Tab');
  await expect(input).toHaveValue(`${fixture.path}/`);
  const added = page.waitForResponse(response => response.url().endsWith('/api/workspace/projects') && response.request().method() === 'POST');
  await page.getByTestId('workspace/project-submit').click();
  expect((await added).ok()).toBe(true);
  await expect(page.getByRole('link', { name: 'review-fixture', exact: true })).toBeVisible();
});

test('recovers from missing folders and dismisses suggestions without closing the dialog', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByTestId('workspace/add-project').click();
  const input = page.getByRole('combobox', { name: 'Local repository path' });
  await input.fill('~/missing/');
  await expect(page.getByRole('alert')).toContainText('Folder not found');
  await input.fill('~/rev');
  await expect(page.getByRole('option', { name: /review-fixture/ })).toBeVisible();
  await input.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await input.fill('~/review-fixture');
  const added = page.waitForResponse(response => response.url().endsWith('/api/workspace/projects') && response.request().method() === 'POST');
  await page.getByTestId('workspace/project-submit').click();
  expect((await added).ok()).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('keeps current suggestions when an older directory response arrives late', async ({ page }) => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  await page.route('**/api/workspace/folders?*', async route => {
    if (new URL(route.request().url()).searchParams.get('path') !== '~/s') return route.continue();
    const response = await route.fetch();
    started.resolve();
    await release.promise;
    await route.fulfill({ response });
    finished.resolve();
  });
  try {
    await page.goto('/');
    await page.getByTestId('workspace/add-project').click();
    const input = page.getByRole('combobox', { name: 'Local repository path' });
    await input.fill('~/s');
    await started.promise;
    await input.fill('~/rev');
    await expect(page.getByRole('option', { name: /review-fixture/ })).toBeVisible();
    release.resolve();
    await finished.promise;
    await expect(page.getByRole('option', { name: /^state-/ })).toHaveCount(0);
    await expect(input).toHaveValue('~/rev');
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const target of ['temporary', 'repository'] as const) {
  test(`checks out into the selected ${target} destination`, async ({ page, request }) => {
    const fixture: { path: string; originalHead: string; firstHead: string } = await (await request.get('/__fixture')).json();
    await request.post('/__short');
    const project: WorkspaceProject = await (await request.post('/api/workspace/projects', { data: { path: fixture.path } })).json();
    await page.goto(`/projects/${project.id}`);
    await page.getByTestId('pr/241/open').click();
    await expect(page.getByRole('radio', { name: /Temporary checkout/ })).toBeChecked();
    if (target === 'repository') await page.getByRole('radio', { name: /Actual repository/ }).check();
    const prepared = page.waitForResponse(response => response.url().endsWith('/prs/241/checkout') && response.request().method() === 'POST');
    await page.getByTestId('workspace/checkout-confirm').click();
    const response = await prepared;
    expect(response.status()).toBe(200);
    await expect(page).toHaveURL(/\/review\/[^/]+\//);
    const id = new URL(page.url()).pathname.split('/')[2];
    const session: WorkspaceSession = await (await request.get(`/api/workspace/sessions/${id}`)).json();
    expect(session.checkoutTarget).toBe(target);
    expect(session.sourceHead).toBe(fixture.firstHead);
    if (target === 'repository') expect(session.checkoutPath).toBe(fixture.path);
    else expect(session.checkoutPath).not.toBe(fixture.path);
    await expect(page.getByTestId('workspace/session-location')).toContainText(session.checkoutPath);
    const current: { currentHead: string } = await (await request.get('/__fixture')).json();
    expect(current.currentHead).toBe(target === 'repository' ? fixture.firstHead : fixture.originalHead);
    const marked = page.waitForResponse(response => response.url().endsWith('/prs/241/reviewed') && response.request().method() === 'POST');
    await page.getByTestId('workspace/session-reviewed').click();
    expect((await marked).ok()).toBe(true);
    await request.post(`/api/workspace/projects/${project.id}/refresh`);
    const snapshot: WorkspaceSnapshot = await (await request.get('/api/workspace')).json();
    expect(snapshot.projects[0]?.pullRequests.find(pr => pr.id === 241)?.status).toBe('reviewed');
  });
}

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
