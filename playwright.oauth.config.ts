import { defineConfig } from '@playwright/test'

// Playwright 1.63 lib/index.js checks this in _takePageSnapshot. Suppress
// failure page snapshots, which can contain provider form values even with
// tracing off. Set here so every spec under tests/oauth inherits it; verify the
// variable is still honored when upgrading the pinned Playwright version.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1'

export default defineConfig({
  testDir: './tests/oauth',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    browserName: 'firefox',
    baseURL: process.env.OAUTH_WEB_BASE_URL ?? 'http://127.0.0.1:8080',
    // OAuth pages carry credentials and state; never record them in artifacts.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
})
