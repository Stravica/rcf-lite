import { defineConfig, devices } from '@playwright/test';

// The pack serves its own preview page. PREVIEW_PORT moves it off the default
// when the port is taken (for example by a parallel run).
const port = Number(process.env.PREVIEW_PORT ?? 47613);

export default defineConfig({
  testDir: 'tests/rcf/ui',
  forbidOnly: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node src/preview-server.ts',
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    env: { PREVIEW_PORT: String(port) },
  },
});
