import { defineConfig } from '@playwright/test';
const port = process.env.SCOPEVIEW_TEST_PORT ?? '4173';
export default defineConfig({
  testDir: './tests/browser',
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1100, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: `pnpm dev --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
