import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request, baseURL }) => { await request.post(`${baseURL}/__reset`); });

test('shows provisional review events before persisted completion', async ({ page }, testInfo) => {
  let reviewStarted = false;
  let readsAfterStart = 0;
  let showProvisional = false;
  let complete = false;
  await page.route('**/api/ai/review', async route => { reviewStarted = true; await route.fulfill({ status: 202, json: { runId: 'run-async', status: 'starting' } }); });
  await page.route('**/api/ai', async route => {
    const response = await route.fetch(); const state = await response.json();
    if (!reviewStarted) return route.fulfill({ response, json: state });
    readsAfterStart++;
    state.activeReviews = !complete ? [{ id: 'run-async', harnessId: 'fixture-harness', head: 'fixture-head', startedAt: new Date().toISOString(), status: showProvisional ? 'classifying' : 'observing', message: showProvisional ? 'Provisional result posted' : 'Inspecting changed files', observations: [], findings: !showProvisional ? [] : [{ id: 'provisional-1', path: 'src/api/devices.ts', line: 3, side: 'new', body: 'Provisional finding', severity: 'warning', anchorCommit: 'fixture-head', reviewId: 'run-async' }], lookouts: !showProvisional ? [] : [{ id: 'provisional-lookout', body: 'Provisional look-out', path: 'src/api/devices.ts', line: 5, side: 'new', anchorCommit: 'fixture-head', reviewId: 'run-async' }] }] : [{ id: 'run-async', harnessId: 'fixture-harness', head: 'fixture-head', startedAt: new Date().toISOString(), status: 'completing', message: 'Finishing', observations: [], findings: [{ id: 'provisional-1', path: 'src/api/devices.ts', line: 3, side: 'new', body: 'Provisional finding', severity: 'warning', anchorCommit: 'fixture-head', reviewId: 'run-async' }], lookouts: [] }];
    if (complete) { state.reviewRuns = [{ id: 'run-async', harnessId: 'fixture-harness', head: 'fixture-head', completedAt: new Date().toISOString(), findings: 1, lookouts: 1, first: { path: 'src/api/devices.ts', line: 3, side: 'new' } }]; state.findings = [{ id: 'final-1', path: 'src/api/devices.ts', line: 3, side: 'new', body: 'Final finding', severity: 'warning', anchorCommit: 'fixture-head', reviewId: 'run-async' }]; state.lookouts = [{ id: 'final-lookout', body: 'Final look-out', path: 'src/api/devices.ts', line: 5, side: 'new', anchorCommit: 'fixture-head', reviewId: 'run-async' }]; }
    await route.fulfill({ response, json: state });
  });
  await page.goto('/'); await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click(); await page.getByRole('button', { name: 'Run AI review' }).click();
  await expect(page.getByTestId('ai/review-status')).toContainText('Inspecting changed files');
  await page.screenshot({ path: testInfo.outputPath('review-progress-desktop.png') });
  showProvisional = true;
  await expect.poll(() => readsAfterStart).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('ai/review-status')).toContainText('Provisional result posted');
  await page.getByRole('tab', { name: /Findings/ }).click();
  await expect(page.getByRole('tab', { name: /Findings/ })).toContainText('2');
  await expect(page.getByTestId('ai-rail').getByTestId('ai/results')).toContainText('Provisional finding');
  await expect(page.getByTestId('ai-rail').getByTestId('ai/results')).toContainText('Provisional look-out');
  await expect(page.getByTestId('ai-rail').getByTestId('ai/results')).toContainText('1 review · 1 finding · 1 look-out');
  await expect(page.getByTestId('ai-rail').getByTestId('ai/results')).not.toContainText('Review 1');
  await page.screenshot({ path: testInfo.outputPath('provisional-results-desktop.png') });
  complete = true;
  await expect.poll(() => readsAfterStart).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('ai/review-result')).toContainText('Review complete');
  await expect(page.getByTestId('ai-rail').getByTestId('ai/results')).toContainText('Final finding');
  await expect(page.getByTestId('ai/active-review/run-async')).toHaveCount(0);
  await expect(page.getByTestId('ai-rail').getByTestId('ai/results')).not.toContainText('Provisional finding');
  await page.screenshot({ path: testInfo.outputPath('completed-results-desktop.png') });
});

test('keeps an incomplete review failed and provisional findings unapprovable', async ({ page }, testInfo) => {
  let reviewStarted = false;
  await page.route('**/api/ai/review', async route => { reviewStarted = true; await route.fulfill({ status: 202, json: { runId: 'run-incomplete', status: 'starting' } }); });
  await page.route('**/api/ai', async route => { const response = await route.fetch(); const state = await response.json(); if (reviewStarted) state.activeReviews = [{ id: 'run-incomplete', harnessId: 'fixture-incomplete', head: 'fixture-head', startedAt: new Date().toISOString(), status: 'incomplete', error: 'Review ended without a complete event', observations: [], findings: [{ id: 'unconfirmed-1', path: 'src/api/devices.ts', line: 3, side: 'new', body: 'Unconfirmed provisional finding', severity: 'warning', anchorCommit: 'fixture-head', reviewId: 'run-incomplete' }], lookouts: [] }]; await route.fulfill({ response, json: state }); });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/'); await page.getByTestId('header').getByRole('button', { name: 'AI', exact: true }).click(); await page.getByLabel('AI harness').selectOption('fixture-incomplete'); await page.getByRole('button', { name: 'Run AI review' }).click();
  await expect(page.getByTestId('ai/review-status')).toContainText('Review incomplete'); await expect(page.getByTestId('ai/review-status')).toContainText('without a complete event'); await page.getByRole('tab', { name: /Findings/ }).click();
  await expect(page.getByRole('tab', { name: /Findings/ })).toContainText('1');
  const provisional = page.getByTestId('ai-rail').getByTestId('ai/result/unconfirmed-1'); await expect(provisional).toContainText('Unconfirmed provisional finding'); await expect(provisional.getByRole('button', { name: 'Approve draft' })).toHaveCount(0);
  await expect(page.getByTestId('ai-rail').getByTestId('ai/results')).toContainText('1 review · 1 finding · 0 look-outs');
  await page.screenshot({ path: testInfo.outputPath('incomplete-results-phone.png') });
});
