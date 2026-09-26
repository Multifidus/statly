import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SERIOUS_IMPACT = new Set(["serious", "critical"]);

type Violation = {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: { target: (string | string[])[]; html: string }[];
};

type Finding = { view: string; theme: string; v: Violation };

/** Run axe against the current page state and stash results for the final report. */
async function scan(page: Page, view: string, theme: string, findings: Finding[]) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  for (const v of results.violations as Violation[]) findings.push({ view, theme, v });
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.goto("/");
  // Skip the first-run tour dialog (scanned separately below) so it doesn't block clicks.
  await page.evaluate((t) => {
    localStorage.setItem("statly.theme", t);
    localStorage.setItem("statly.onboarding", "done");
  }, theme);
  await page.reload();
}

async function openExampleProject(page: Page) {
  await page.goto("/");
  await page.getByTestId("open-project").click();
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Example project.statly" }).click();
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
}

/** Click one Advisor radio option (matched by its visible label) and continue. */
async function answerAdvisor(page: Page, labelPattern: RegExp) {
  const q = page.getByTestId("advisor-question");
  await expect(q).toBeVisible();
  await q.getByRole("radio", { name: labelPattern }).click();
  const next = page.getByTestId("advisor-next");
  await expect(next).toBeEnabled();
  await next.click();
}

/**
 * Scripted path to a recommendation for the example project: default outcome is `math_attitude`
 * (a scale_score, ranked first by outcomeCandidates), which the mock advisor tree
 * (app/src/mocks/advisor.ts) auto-fills as outcome_level "continuous" and, from the dataset's
 * linked pre/post stacking, num_time_points 2 / linked_mode true. So "compare" -> "repeated,
 * linked" walks straight to rec_t_paired (num_time_points auto-answers "two"), matching the
 * mixed-design walk in advisorMixedDesign.test.ts but for this project's two-time-point data.
 */
async function reachAdvisorRecommendation(page: Page) {
  await answerAdvisor(page, /Did scores change over time, or differ between groups\?/);
  await answerAdvisor(page, /Same respondents, measured more than once \(linked\)/);
  await expect(page.getByTestId("recommendation")).toBeVisible();
}

/** Visit all 13 views (dataset loaded where needed) and axe-scan each one. */
async function scanAllViews(page: Page, theme: string, findings: Finding[]) {
  // home (no project loaded yet)
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to Statly" })).toBeVisible();
  await scan(page, "home", theme, findings);

  // import
  await page.getByTestId("new-project").click();
  await expect(page.getByRole("heading", { name: "Choose files" })).toBeVisible();
  await scan(page, "import", theme, findings);

  // planner (also reached from Home)
  await page.goto("/");
  await page.getByTestId("plan-study").click();
  await expect(page.getByRole("heading", { name: "Study Planner" })).toBeVisible();
  await scan(page, "planner", theme, findings);

  // dataset-backed views via the example project
  await openExampleProject(page);
  await scan(page, "data", theme, findings);

  await page.getByTestId("tab-variables").click();
  await expect(page.getByTestId("variables-title")).toBeVisible();
  await scan(page, "variables", theme, findings);

  // interview, from Variables
  await page.getByRole("button", { name: /Variable interview/ }).click();
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await scan(page, "interview", theme, findings);

  await openExampleProject(page);
  await page.getByTestId("tab-advisor").click();
  await expect(page.getByTestId("advisor-screen")).toBeVisible();
  await scan(page, "advisor", theme, findings);

  await reachAdvisorRecommendation(page);
  await page.getByTestId("rec-continue").click();
  await scan(page, "analysis", theme, findings);

  await openExampleProject(page);
  await page.getByTestId("tab-analyses").click();
  await expect(page.getByTestId("analyses-screen")).toBeVisible();
  await scan(page, "analyses", theme, findings);

  const firstEntry = page.locator('[data-testid^="log-entry-"]').first();
  if (await firstEntry.isVisible().catch(() => false)) {
    await firstEntry.click();
    await expect(page.getByTestId("results-screen")).toBeVisible();
    await scan(page, "results", theme, findings);
  }

  await openExampleProject(page);
  await page.getByTestId("tab-charts").click();
  await expect(page.getByTestId("charts-list")).toBeVisible();
  await scan(page, "charts", theme, findings);

  await page.getByTestId("tab-qualitative").click();
  await expect(page.getByTestId("qual-title")).toBeVisible();
  await scan(page, "qualitative", theme, findings);

  await page.getByTestId("open-learn").click();
  await scan(page, "learn", theme, findings);
}

for (const theme of ["light", "dark"] as const) {
  test(`axe scan: all views (${theme} theme)`, async ({ page }, testInfo: TestInfo) => {
    const findings: Finding[] = [];
    await setTheme(page, theme);
    await scanAllViews(page, theme, findings);
    reportAndAssert(theme, findings, testInfo);
  });
}

test("axe scan: onboarding tour", async ({ page }, testInfo: TestInfo) => {
  const findings: Finding[] = [];
  await page.addInitScript(() => localStorage.removeItem("statly.onboarding"));
  await page.goto("/");
  await expect(page.getByTestId("onboarding-tour")).toBeVisible();
  await scan(page, "onboarding-tour", "light", findings);
  reportAndAssert("onboarding-tour", findings, testInfo);
});

/** Log moderate/minor findings, then fail only on serious/critical. */
function reportAndAssert(label: string, mine: Finding[], testInfo: TestInfo) {
  const serious = mine.filter((f) => SERIOUS_IMPACT.has(f.v.impact ?? ""));
  const minor = mine.filter((f) => !SERIOUS_IMPACT.has(f.v.impact ?? ""));

  if (minor.length) {
    // eslint-disable-next-line no-console
    console.log(
      `[a11y:${label}] moderate/minor violations:\n` +
        minor
          .map((f) => `  ${f.v.id} (${f.v.impact}) on ${f.view}: ${f.v.nodes[0]?.target.join(" ")}`)
          .join("\n"),
    );
  }
  for (const f of mine) {
    const targets = f.v.nodes.slice(0, 5).map((n) => n.target.join(" "));
    testInfo.annotations.push({
      type: "a11y",
      description: `${f.view}/${f.theme} ${f.v.id} (${f.v.impact}) x${f.v.nodes.length} @ ${targets.join(" | ")}`,
    });
  }
  expect(serious, JSON.stringify(serious.map((f) => ({ view: f.view, rule: f.v.id, impact: f.v.impact })), null, 2)).toEqual([]);
}
