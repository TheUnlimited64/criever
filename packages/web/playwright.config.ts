import { defineConfig } from '@playwright/test';
const port = Number(process.env.CRIEVER_E2E_PORT ?? 4799);
export default defineConfig({
  testDir: 'e2e', timeout: 30000, retries: 0, workers: 1,
  use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
  webServer: [
    { command: `bun run ../cli/fixtures/harness.ts --port ${port} --static dist`, url: `http://127.0.0.1:${port}/api/pr`, reuseExistingServer: false, timeout: 60000 },
    { command: `bun run ../cli/fixtures/harness.ts --local --port ${port + 2} --static dist`, url: `http://127.0.0.1:${port + 2}/api/pr`, reuseExistingServer: false, timeout: 60000 },
    { command: `bun run ../cli/fixtures/daemon-harness.ts --port ${port + 4}`, url: `http://127.0.0.1:${port + 4}/api/workspace`, reuseExistingServer: false, timeout: 60000 },
  ],
  projects: [
    { name: 'bitbucket', testIgnore: /(?:agent|workspace|review-filters)\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${port}` } },
    { name: 'local', testMatch: /(?:agent|ai|ai-responsive|ai-async)\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${port + 2}` } },
    { name: 'daemon', testMatch: /(?:workspace|review-filters)\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${port + 4}` } },
  ],
});
