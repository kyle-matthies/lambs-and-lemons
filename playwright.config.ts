import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/platform/**',
  timeout: 60_000,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    // iPhone 14 metrics, but always on Chromium — WebKit isn't provisioned in
    // the environments this runs in (PLAYWRIGHT_BROWSERS_PATH ships Chromium).
    ...devices['iPhone 14'],
    browserName: 'chromium',
    launchOptions: {
      // The game is WebGL now. Headless Chromium has no GPU, so force the
      // SwiftShader software rasteriser or every canvas comes back blank.
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
