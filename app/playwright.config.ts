import { defineConfig, devices } from "@playwright/test";

const PORT = 1430;

/** E2E runs against the Vite dev server in mock-engine mode (no Tauri, no Python). */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_STATLY_MOCK: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
