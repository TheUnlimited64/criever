import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', timeout: 30000, retries: 0, workers: 1,
  use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
  webServer: [
    { command: 'bun run ../cli/fixtures/harness.ts --port 4799 --static dist', url: 'http://127.0.0.1:4799/api/pr', reuseExistingServer: false, timeout: 60000 },
    { command: 'bun run ../cli/fixtures/harness.ts --local --port 4801 --static dist', url: 'http://127.0.0.1:4801/api/pr', reuseExistingServer: false, timeout: 60000 },
  ],
  projects: [
    { name: 'bitbucket', testIgnore: /agent\.spec\.ts$/, use: { baseURL: 'http://127.0.0.1:4799' } },
    { name: 'local', testMatch: /(?:agent|ai|ai-responsive)\.spec\.ts$/, use: { baseURL: 'http://127.0.0.1:4801' } },
  ],
});
