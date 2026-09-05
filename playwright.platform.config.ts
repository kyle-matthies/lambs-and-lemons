import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/platform',
  timeout: 90_000,
  retries: 0,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'iphone-chromium',
      use: {
        ...devices['iPhone 14'],
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
    {
      name: 'iphone-webkit',
      use: { ...devices['iPhone 14'], browserName: 'webkit' },
    },
    {
      name: 'desktop-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 4175 --strictPort',
    url: 'http://localhost:4175',
    reuseExistingServer: true,
  },
})
