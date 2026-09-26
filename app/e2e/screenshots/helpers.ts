import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DOCS_SCREENSHOTS_DIR = path.resolve(__dirname, "../../../docs/screenshots");

export type StepResult = { tutorial: string; step: number; screenshot: string | null; status: "captured" | "skipped" | "failed"; note?: string };

const results: StepResult[] = [];

export function record(r: StepResult) {
  results.push(r);
  const label = r.status === "captured" ? "OK" : r.status === "skipped" ? "SKIP" : "FAIL";
  // eslint-disable-next-line no-console
  console.log(`[${label}] ${r.tutorial} step ${r.step}${r.note ? ` - ${r.note}` : ""}`);
}

export function writeReport() {
  fs.mkdirSync(DOCS_SCREENSHOTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DOCS_SCREENSHOTS_DIR, "capture-report.json"), JSON.stringify(results, null, 2));
}

/** Applies the tutorial's light/dark preference before the app's theme store reads localStorage. */
export async function setTheme(page: Page, dark: boolean) {
  await page.addInitScript((isDark) => {
    window.localStorage.setItem("statly.theme", isDark ? "dark" : "light");
  }, dark);
}

/** Small fixed-position banner naming the tutorial step, injected just before the screenshot. */
async function addOverlay(page: Page, text: string) {
  await page.evaluate((label) => {
    const el = document.createElement("div");
    el.id = "__statly_screenshot_overlay";
    el.textContent = label;
    Object.assign(el.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      zIndex: "2147483647",
      background: "#111827",
      color: "#fff",
      font: "600 13px/1.4 -apple-system, BlinkMacSystemFont, sans-serif",
      padding: "6px 12px",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
  }, text);
}

async function removeOverlay(page: Page) {
  await page.evaluate(() => document.getElementById("__statly_screenshot_overlay")?.remove());
}

/**
 * Runs one tutorial step. `body` performs the app interaction; on success, an
 * overlay label is added and the page is screenshotted to `docs/screenshots/<tutorial>/<file>`.
 * Any failure (a selector that doesn't exist, a timeout) is caught and recorded as "failed"
 * rather than throwing, so one broken step never aborts the whole capture run.
 */
export async function step(
  page: Page,
  opts: { tutorial: string; step: number; file: string | null; label: string; built: boolean; todo?: string },
  body: () => Promise<void>,
) {
  if (!opts.built || !opts.file) {
    record({ tutorial: opts.tutorial, step: opts.step, screenshot: null, status: "skipped", note: opts.todo ?? "not built yet" });
    return;
  }
  try {
    await body();
    await addOverlay(page, `${opts.tutorial} - step ${opts.step}: ${opts.label}`);
    const dir = path.join(DOCS_SCREENSHOTS_DIR, opts.tutorial);
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, opts.file) });
    await removeOverlay(page);
    record({ tutorial: opts.tutorial, step: opts.step, screenshot: opts.file, status: "captured" });
  } catch (err) {
    try {
      const dir = path.join(DOCS_SCREENSHOTS_DIR, "_debug");
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `${opts.tutorial}-step${opts.step}.png`) }).catch(() => {});
    } catch {
      // best-effort debug artifact only
    }
    record({ tutorial: opts.tutorial, step: opts.step, screenshot: null, status: "failed", note: (err as Error).message.split("\n")[0] });
  }
}
