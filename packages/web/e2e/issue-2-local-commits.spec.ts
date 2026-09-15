import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { PrInfo } from '@criever/shared';
import { expect, test } from '@playwright/test';

interface Issue2ServerInfo {
  readonly url: string;
  readonly localHead: string;
}

const isServerInfo = (value: unknown): value is Issue2ServerInfo =>
  typeof value === 'object' && value !== null && 'url' in value && typeof value.url === 'string' &&
  'localHead' in value && typeof value.localHead === 'string';

const isPrInfo = (value: unknown): value is PrInfo =>
  typeof value === 'object' && value !== null && 'remoteSourceHead' in value && typeof value.remoteSourceHead === 'string' &&
  'commits' in value && Array.isArray(value.commits);

const webRoot = new URL('..', import.meta.url).pathname;
let serverProcess: ChildProcessByStdio<null, Readable, null> | undefined;
let serverInfo: Issue2ServerInfo | undefined;

test.beforeAll(async () => {
  serverProcess = spawn('/root/.bun/bin/bun', ['run', '../cli/test/fixtures/issue-2-harness.ts', '--port', '0', '--static', 'dist'], {
    cwd: webRoot,
    env: { ...process.env, PATH: `/root/.bun/bin:${process.env.PATH ?? ''}` },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const child = serverProcess;
  if (!child) throw new Error('Issue 2 harness process was not created');
  const lines = createInterface({ input: child.stdout });
  serverInfo = await new Promise<Issue2ServerInfo>((resolve, reject) => {
    lines.once('line', line => {
      const parsed: unknown = JSON.parse(line);
      if (isServerInfo(parsed)) resolve(parsed);
      else reject(new Error('Issue 2 harness returned invalid server info'));
      lines.close();
    });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Issue 2 harness exited before startup (${code ?? 'signal'})`)));
  });
});

test.afterAll(() => {
  serverProcess?.kill();
});

test.beforeEach(async ({ request }) => {
  const info = serverInfo;
  if (!info) throw new Error('Issue 2 harness did not start');
  const response = await request.get(`${info.url}/__reset`);
  expect(response.ok()).toBeTruthy();
});

test('overview marks local-only work in whole and selected review states', async ({ page }) => {
  const info = serverInfo;
  if (!info) throw new Error('Issue 2 harness did not start');

  // Given: the checked-out PR branch has a committed descendant absent from Bitbucket's source head.
  // When: the browser loads the review and opens its overview.
  await page.goto(info.url);
  await expect(page.getByTestId('files/count')).toBeVisible();
  await expect(page.getByTestId('files/file/src%2Flocal-only.ts')).toBeVisible();
  await expect(page.getByTestId('header/localOnly')).toContainText('local-only');
  await page.getByTestId('header/overviewButton').click();

  // Then: the local commit is visibly marked, and selecting it exposes the local-only range state.
  const short = info.localHead.slice(0, 7);
  const localCommit = page.getByTestId(`overview/commit/${short}`);
  await expect(localCommit).toBeVisible();
  await expect(localCommit.getByTestId(`overview/commit/${short}/localOnly`)).toBeVisible();
  await localCommit.click();
  await expect(page.getByTestId('overview/status')).toContainText('local-only');
  await expect(page.getByTestId('header/rangeChip')).toContainText('local-only');

  // When: the selected range is extended to include the remote-backed anchor.
  await page.getByTestId('overview/commits').getByRole('button').nth(2).click({ modifiers: ['Shift'] });

  // Then: the mixed range keeps the local-only state in both review surfaces.
  await expect(page.getByTestId('overview/status')).toContainText('local-only');
  await expect(page.getByTestId('header/rangeChip')).toContainText('local-only');
  await page.getByTestId('overview/wholeReview').click();
  await expect(page.getByTestId('overview/status')).toContainText('local-only work included');
});

test('publish sheet keeps a local-only draft pending with an explanation', async ({ page }) => {
  const info = serverInfo;
  if (!info) throw new Error('Issue 2 harness did not start');

  // Given: a draft is written against the effective local review head.
  await page.goto(info.url);
  await page.getByTestId('files/file/src%2Flocal-only.ts').click();
  await page.getByTestId('code/row/new/1/gutter').click();
  await page.getByTestId('composer/text').fill('local-only feedback');
  await page.getByTestId('composer/save').click();

  // When: the draft is sent while its anchor is absent from the remote source head.
  await page.getByTestId('header/publishButton').click();
  const sheet = page.getByTestId('publishSheet');
  await sheet.getByTestId('publishSheet/confirm').click();

  // Then: the sheet stays open, retains the row, and distinguishes pending from failure.
  await expect(sheet).toBeVisible();
  const pendingRow = sheet.locator('.sheet-row.pending');
  await expect(pendingRow).toHaveCount(1);
  await expect(pendingRow).toContainText('pending');
  await expect(pendingRow).toContainText('remote source head');
  await expect(pendingRow).not.toHaveClass(/failed/);
  await expect(sheet.getByTestId('publishSheet/pendingNotice')).toContainText('local-only');
  await expect(page.getByTestId('header/draftCount')).toContainText('1 draft');
});

test('publish sheet retains pending rows beside successfully published rows', async ({ page }) => {
  const info = serverInfo;
  if (!info) throw new Error('Issue 2 harness did not start');

  // Given: two drafts are visible in the publish sheet.
  await page.goto(info.url);
  await page.getByTestId('files/file/src%2Flocal-only.ts').click();
  await page.getByTestId('code/row/new/1/gutter').click();
  await page.getByTestId('composer/text').fill('pending local feedback');
  await page.getByTestId('composer/save').click();
  await page.getByTestId('files/file/src%2Fdevices%2FuseDeviceRows.ts').click();
  await page.getByTestId('code/row/new/1/gutter').click();
  await page.getByTestId('composer/text').fill('eligible remote feedback');
  await page.getByTestId('composer/save').click();
  await page.getByTestId('header/publishButton').click();
  const sheet = page.getByTestId('publishSheet');
  const ids = await sheet.locator('div[data-testid^="publishSheet/row/"]').evaluateAll(elements => elements
    .map(element => element.getAttribute('data-testid')?.split('/')[2])
    .filter((id): id is string => typeof id === 'string'));
  const pendingId = ids[0];
  const publishedId = ids[1];
  if (!pendingId || !publishedId) throw new Error('Issue 2 publish rows were not rendered');

  // When: the stream reports one local-only draft and one eligible draft.
  await page.route('**/api/publish', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify({ draftId: pendingId, ok: false, pending: true, error: 'Draft is pending until its anchor is present at the remote source head.' })}\n${JSON.stringify({ draftId: publishedId, ok: true, commentId: 9001 })}\n`,
    });
  });
  await sheet.getByTestId('publishSheet/confirm').click();

  // Then: successful rows say published while pending local-only work remains visible and distinct.
  await expect(sheet.locator('.sheet-row.ok')).toHaveCount(1);
  await expect(sheet.locator('.sheet-row.pending')).toHaveCount(1);
  await expect(sheet.getByTestId(`publishSheet/row/${publishedId}`)).toContainText('published');
  await expect(sheet.getByTestId(`publishSheet/row/${pendingId}`)).toContainText('pending');
  await expect(sheet.getByTestId(`publishSheet/row/${pendingId}`)).not.toHaveClass(/failed/);
});

test('equal source heads do not show local-only labels', async ({ page }) => {
  const info = serverInfo;
  if (!info) throw new Error('Issue 2 harness did not start');

  // Given: the UI receives the same review shape after the remote source catches up.
  await page.route('**/api/pr', async route => {
    const response = await route.fetch();
    const body: unknown = await response.json();
    if (!isPrInfo(body)) throw new Error('Issue 2 harness returned invalid PR info');
    await route.fulfill({ response, json: { ...body, sourceHead: body.remoteSourceHead, commits: body.commits.filter(c => c.localOnly !== true) } });
  });
  await page.goto(info.url);

  // Then: neither the header nor whole-review overview advertises local-only work.
  await expect(page.getByTestId('header/localOnly')).toHaveCount(0);
  await page.getByTestId('header/overviewButton').click();
  await expect(page.getByTestId('overview/status')).not.toContainText('local-only');
  await expect(page.getByTestId('overview').getByText('local-only')).toHaveCount(0);
});
