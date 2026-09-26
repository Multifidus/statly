import { test as base, expect, type Page } from "@playwright/test";
export type { Page };

/** Shared e2e fixture: seeds the first-run onboarding tour as already dismissed so it doesn't
 * intercept clicks in specs that aren't testing onboarding itself. Real users still see the tour
 * on their true first run; this only affects Playwright's empty-localStorage starting state. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("statly.onboarding", "done");
    });
    await use(page);
  },
});

export { expect };
