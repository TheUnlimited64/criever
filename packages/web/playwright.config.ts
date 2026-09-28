import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', timeout: 30000, retries: 0, workers: 1,
  use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
  webServer: [
    { command: 'bun run ../cli/fixtures/harness.ts --port 4799 --static dist', url: 'http://127.0.0.1:4799/api/pr', reuseExistingServer: false, timeout: 60000 },
    { command: 'bun run ../cli/fixtures/harness.ts --local --port 4801 --static dist', url: 'http://127.0.0.1:4801/api/pr', reuseExistingServer: false, timeout: 60000 },
    { command: 'bun run ../cli/fixtures/daemon-harness.ts --port 4803', url: 'http://127.0.0.1:4803/api/workspace', reuseExistingServer: false, timeout: 60000 },
  ],
  projects: [
    { name: 'bitbucket', testIgnore: /(?:agent|workspace|review-filters)\.spec\.ts$/, use: { baseURL: 'http://127.0.0.1:4799' } },
    { name: 'local', testMatch: /(?:agent|ai|ai-responsive|ai-async)\.spec\.ts$/, use: { baseURL: 'http://127.0.0.1:4801' } },
    { name: 'daemon', testMatch: /(?:workspace|review-filters)\.spec\.ts$/, use: { baseURL: 'http://127.0.0.1:4803' } },
  ],
});
