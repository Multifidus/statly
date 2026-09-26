import { defineConfig, devices } from "@playwright/test";

const PORT = 1431;

/**
 * Screenshot-capture project (SPEC §11.4): a SEPARATE Playwright project from
 * playwright.config.ts / the e2e suite, so `npm run test:e2e` is untouched.
 * Walks each tutorial in content/tutorials/tutorials.yaml against the app
 * running in mock-engine mode (no Tauri, no Python), and saves annotated
 * screenshots to docs/screenshots/<tutorial-id>/<step>.png.
 *
 * The built desktop app can't be driven here: Tauri's WebKit WebView has no
 * WebDriver support on macOS, so there is no way to automate the packaged
 * .app the way Playwright automates a browser. Screenshots come from the
 * same React UI running in a real browser instead (see docs/TUTORIALS.md).
 */
export default defineConfig({
  testDir: "e2e/screenshots",
  // Each test walks a whole tutorial (up to 14 sequential UI steps, some with
  // multi-click interview loops), so the per-test budget is much larger than
  // the normal e2e suite's single-flow tests.
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    trace: "off",
    // A short per-action timeout so one missing/renamed selector fails fast
    // (and the failure is captured with a live page) instead of eating the
    // whole test's budget and taking every later step down with it.
    actionTimeout: 10_000,
  },
  projects: [{ name: "screenshots", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_STATLY_MOCK: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
