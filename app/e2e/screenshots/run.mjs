#!/usr/bin/env node
/**
 * Wrapper for `npm run screenshots` so a single npm script (per SPEC §11.4
 * delegation: only one script anchor added to package.json) can still take a
 * `--dark` flag without Playwright's own CLI trying to parse it.
 *
 *   npm run screenshots          -> light theme (default)
 *   npm run screenshots -- --dark -> dark theme
 */
import { spawnSync } from "node:child_process";

const dark = process.argv.includes("--dark");

const result = spawnSync("npx", ["playwright", "test", "--config=playwright.screenshots.config.ts"], {
  stdio: "inherit",
  env: { ...process.env, STATLY_SCREENSHOTS_THEME: dark ? "dark" : "light" },
});

process.exit(result.status ?? 1);
