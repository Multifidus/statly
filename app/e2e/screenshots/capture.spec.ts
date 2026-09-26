import { expect, test, type Locator, type Page } from "@playwright/test";
import { setTheme, step, writeReport } from "./helpers";

test.afterAll(writeReport);

/**
 * Screenshot capture for the four SPEC §11.4 tutorials, driven by the step
 * table in content/tutorials/tutorials.yaml (kept in sync by hand: step id,
 * screenshot filename, and `built` flag here match that file 1:1, since this
 * project intentionally has no runtime YAML-parsing dependency).
 *
 * Reuses selectors from app/e2e/*.spec.ts (the mock-mode e2e flows) rather
 * than inventing new ones, per the SPEC §11.4 delegation. Every step is
 * wrapped in `step()`, which catches failures so one missing/renamed
 * selector never aborts the whole run - it just gets recorded as "failed"
 * (distinct from "skipped", which is a step whose screen isn't built yet).
 *
 * Run with `npm run screenshots` (add `-- --dark` for the dark-theme pass).
 */

const DARK = process.env.STATLY_SCREENSHOTS_THEME === "dark";

test.beforeEach(async ({ page }) => {
  await setTheme(page, DARK);
});

/**
 * Several practice datasets share plain file names ("pre.csv", "post.csv"), so a checkbox
 * lookup by name alone is ambiguous across the mock dialog's file groups (fieldsets). Scope
 * to the fieldset whose legend matches `group` (see MOCK_FILES in src/mocks/shapes.ts).
 */
async function openMockDialog(page: Page, group: string, files: string[]) {
  await page.getByTestId("new-project").click();
  await page.getByTestId("choose-files").click();
  const dialog = page.getByTestId("mock-dialog");
  const fieldset = dialog.locator("fieldset").filter({ has: page.getByText(group, { exact: true }) });
  for (const f of files) await fieldset.getByRole("checkbox", { name: f }).check();
  await dialog.getByRole("button", { name: "Open" }).click();
}

/** Retries a click once on failure (Radix radio/option nodes occasionally re-render mid-click). */
async function clickRetry(locator: Locator) {
  try {
    await locator.click();
  } catch {
    await locator.click();
  }
}

async function skipInterview(page: Page) {
  await page.getByRole("button", { name: "Skip for now" }).click();
  // Skipping commits a raw pass-through import asynchronously before navigating; wait for
  // a landing screen so a later step's click doesn't race a still-in-flight navigation.
  await Promise.race([
    page.getByTestId("data-title").waitFor({ state: "visible" }),
    page.getByTestId("variables-title").waitFor({ state: "visible" }),
  ]);
}

async function finishInterview(page: Page) {
  const heading = page.locator("#interview-title");
  for (let i = 0; i < 80; i++) {
    if ((await heading.textContent()) === "Summary") break;
    await page.getByTestId("interview-next").click();
  }
  await page.getByTestId("interview-next").click();
  // Finishing commits the interview (scale creation, role assignment, etc.) via async
  // store calls before navigating to Variables; wait for that landing screen so a later
  // step's click doesn't race a still-in-flight navigation back to it.
  await page.getByTestId("variables-title").waitFor({ state: "visible" });
}

// ---------------------------------------------------------------------------
// Tutorial 1: did-my-students-improve (one_group_prepost_likert)
// ---------------------------------------------------------------------------
test("did-my-students-improve", async ({ page }) => {
  const t = "did-my-students-improve";

  await step(page, { tutorial: t, step: 1, file: "01-home.png", label: "Home", built: true }, async () => {
    await page.goto("/");
  });

  await step(page, { tutorial: t, step: 2, file: "02-choose-files.png", label: "Choose files", built: true }, async () => {
    await openMockDialog(page, "One group, pre/post", ["pre.csv", "post.csv"]);
  });

  await step(page, { tutorial: t, step: 3, file: "03-detection.png", label: "Detection", built: true }, async () => {
    await page.getByTestId("wizard-next").click();
  });

  await step(page, { tutorial: t, step: 4, file: "04-cleanup.png", label: "Survey clean-up", built: true }, async () => {
    await page.getByTestId("wizard-next").click();
  });

  await step(page, { tutorial: t, step: 5, file: "05-review-import.png", label: "Review and import", built: true }, async () => {
    // Two files -> the wizard inserts "Combine time points" and "Link people across time"
    // steps between clean-up and the final summary (no linking ID for this dataset, so the
    // default "Don't link" choice on the link step is left as-is).
    await page.getByTestId("wizard-next").click(); // cleanup -> stack
    await page.getByTestId("wizard-next").click(); // stack -> link
    await page.getByTestId("wizard-next").click(); // link -> summary
  });

  await step(page, { tutorial: t, step: 6, file: "06-interview-scales.png", label: "Reverse-score the scale", built: true }, async () => {
    await page.getByTestId("wizard-next").click(); // summary "Import" -> commits, auto-opens the interview
    const heading = page.locator("#interview-title");
    for (let i = 0; i < 80; i++) {
      if ((await heading.textContent()) === "Scales") break;
      await page.getByTestId("interview-next").click();
    }
  });

  await step(page, { tutorial: t, step: 7, file: "07-variables.png", label: "Variables", built: true }, async () => {
    await finishInterview(page);
  });

  await step(page, { tutorial: t, step: 8, file: "08-advisor-question.png", label: "What do you want to know?", built: true }, async () => {
    await page.getByTestId("tab-advisor").click();
    await page.getByTestId("advisor-question").waitFor({ state: "visible" });
    await page.getByTestId("advisor-question").getByText("Did scores change over time, or differ between groups?").click();
  });

  await step(page, { tutorial: t, step: 9, file: "09-advisor-linked.png", label: "Not linked across time", built: true }, async () => {
    await page.getByTestId("advisor-next").click();
    await page.getByTestId("advisor-question").getByText(/respondents are NOT linked/).click();
  });

  await step(page, { tutorial: t, step: 10, file: "10-recommendation.png", label: "Recommendation", built: true }, async () => {
    await page.getByTestId("advisor-next").click();
    await page.getByTestId("recommendation").waitFor({ state: "visible" });
  });

  await step(page, { tutorial: t, step: 11, file: "11-roles.png", label: "Variable roles", built: true }, async () => {
    await page.getByTestId("rec-continue").click();
    await page.getByTestId("flow-run").waitFor({ state: "visible" });
  });

  await step(page, { tutorial: t, step: 12, file: "12-assumptions.png", label: "Assumption checks", built: true }, async () => {
    await page.getByTestId("flow-run").click();
    await page.getByTestId("assumption-step").waitFor({ state: "visible" });
  });

  await step(page, { tutorial: t, step: 13, file: "13-results.png", label: "Results", built: true }, async () => {
    await page.getByTestId("assumption-next").click();
    await page.getByTestId("assumption-next").click();
    await page.getByTestId("assumption-next").click();
    await page.getByText(/Use the recommended test/).click();
    await page.getByTestId("decision-confirm").click();
    await page.getByTestId("results-view").waitFor({ state: "visible" });
  });

  await step(page, { tutorial: t, step: 14, file: "14-reliability.png", label: "Scale reliability", built: true }, async () => {
    await page.getByTestId("tab-advisor").click();
    // The Analyze tab now shows a recap of the completed t-test path (with "Change" links);
    // start a fresh question to ask about reliability instead.
    await page.getByRole("button", { name: "Start over" }).click();
    await page.getByTestId("advisor-question").waitFor({ state: "visible" });
    await page.getByTestId("advisor-question").getByText("Do my survey questions hang together?").click();
    await page.getByTestId("advisor-next").click();
  });
});

// ---------------------------------------------------------------------------
// Tutorial 2: which-intervention-worked-best (three_groups_prepost_followup)
// ---------------------------------------------------------------------------
test("which-intervention-worked-best", async ({ page }) => {
  const t = "which-intervention-worked-best";

  await step(page, { tutorial: t, step: 1, file: "01-home.png", label: "Home", built: true }, async () => {
    await page.goto("/");
  });

  await step(page, { tutorial: t, step: 2, file: "02-choose-files.png", label: "Choose files", built: true }, async () => {
    await openMockDialog(page, "Three groups, three times", ["pre.csv", "post.csv", "followup.csv"]);
  });

  await step(page, { tutorial: t, step: 3, file: "03-detection.png", label: "Detection", built: true }, async () => {
    await page.getByTestId("wizard-next").click();
  });

  await step(page, { tutorial: t, step: 4, file: "04-cleanup.png", label: "Survey clean-up", built: true }, async () => {
    await page.getByTestId("wizard-next").click();
  });

  await step(page, { tutorial: t, step: 5, file: "05-review-import.png", label: "Review and import", built: true }, async () => {
    // Three files -> the wizard inserts "Combine time points" and "Link people across time"
    // steps between clean-up and the final summary (no linking ID for this dataset, so the
    // default "Don't link" choice on the link step is left as-is).
    await page.getByTestId("wizard-next").click(); // cleanup -> stack
    // SC0 (pre/post) vs SC1 (followup) look like the same score column renamed; accept the
    // match so "Continue" unblocks (StepStacking requires a decision on every renamed match).
    for (const renamed of await page.locator('[data-testid^="renamed-"]').all()) {
      await renamed.getByRole("radio", { name: /Same question/ }).click();
    }
    await page.getByTestId("wizard-next").click(); // stack -> link
    await page.getByTestId("wizard-next").click(); // link -> summary
  });

  await step(page, { tutorial: t, step: 6, file: "06-interview-answer-key.png", label: "Test scoring", built: true }, async () => {
    await page.getByTestId("wizard-next").click(); // summary "Import" -> commits, auto-opens the interview
    const heading = page.locator("#interview-title");
    for (let i = 0; i < 80; i++) {
      if ((await heading.textContent()) === "Test scoring") break;
      await page.getByTestId("interview-next").click();
    }
  });

  await step(page, { tutorial: t, step: 7, file: "07-variables.png", label: "Variables", built: true }, async () => {
    // The mock file dialog can't hand back a real answer-key CSV, so unblock "Continue"
    // with the interview's built-in "Skip for now" path (score later from Variables)
    // instead of "Score with an answer key" (screenshotted at step 6 as the default view).
    const skipScoring = page.getByRole("radio", { name: "Skip for now" });
    if (await skipScoring.isVisible().catch(() => false)) await skipScoring.click();
    await finishInterview(page);
  });

  await step(page, { tutorial: t, step: 8, file: "08-advisor-question.png", label: "What do you want to know?", built: true }, async () => {
    await page.getByTestId("tab-advisor").click();
    await page.getByTestId("advisor-question").waitFor({ state: "visible" });
    await page.getByTestId("advisor-question").getByText("Did scores change over time, or differ between groups?").click();
  });

  await step(page, { tutorial: t, step: 9, file: "09-recommendation.png", label: "Recommendation", built: true }, async () => {
    await page.getByTestId("advisor-next").click();
    const independentGroups = page.getByTestId("advisor-question").getByRole("radio", { name: /^Independent groups/ });
    await clickRetry(independentGroups);
    await expect(independentGroups).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("advisor-next").click();
    // "How many groups?" is answered from the data (3 groups detected); the radio is
    // pre-filled but may render only briefly before Statly auto-advances past it, so
    // only click it if it's still there instead of waiting on a selector that may
    // already be gone.
    const threeOrMore = page.getByTestId("advisor-question").getByRole("radio", { name: /^Three or more/ });
    if (await threeOrMore.isVisible().catch(() => false)) {
      await clickRetry(threeOrMore);
      await page.getByTestId("advisor-next").click();
    }
    await page.getByTestId("recommendation").waitFor({ state: "visible" });
  });

  await step(page, { tutorial: t, step: 10, file: "10-roles.png", label: "Variable roles", built: true }, async () => {
    await page.getByTestId("rec-continue").click();
    await page.getByTestId("flow-run").waitFor({ state: "visible" });
  });

  await step(page, { tutorial: t, step: 11, file: "11-assumptions.png", label: "Assumption checks", built: true }, async () => {
    // anova.one_way and kruskal_wallis are now in the mock catalog (roles pre-fill from the
    // interview's variable roles, single "default" layout, so no layout picker appears).
    await page.getByTestId("flow-run").click();
    await page.getByTestId("assumption-progress").waitFor({ state: "visible" });
  });

  await step(page, { tutorial: t, step: 12, file: "12-results.png", label: "Results and post hoc", built: true }, async () => {
    // Walk through the remaining assumption screens (one per group, plus homogeneity of
    // variance) to the decision step, then run and land on results.
    for (let i = 0; i < 20; i++) {
      const next = page.getByTestId("assumption-next");
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
    }
    await page.getByTestId("decision-suggestion").waitFor({ state: "visible" });
    await page.getByTestId("decision-confirm").click();
    await page.getByTestId("results-view").waitFor({ state: "visible" });
  });

  await step(
    page,
    {
      tutorial: t,
      step: 13,
      file: null,
      label: "Mixed/repeated-measures ANOVA across all three time points",
      built: false,
      todo: "Mixed ANOVA is not yet reachable from the Test Advisor; repeat the one-way ANOVA at each time point instead.",
    },
    async () => {},
  );
});

// ---------------------------------------------------------------------------
// Tutorial 3: cleaning-a-messy-qualtrics-export (messy_qualtrics)
// ---------------------------------------------------------------------------
test("cleaning-a-messy-qualtrics-export", async ({ page }) => {
  const t = "cleaning-a-messy-qualtrics-export";

  await step(page, { tutorial: t, step: 1, file: "01-home.png", label: "Home", built: true }, async () => {
    await page.goto("/");
  });

  await step(page, { tutorial: t, step: 2, file: "02-choose-files.png", label: "Choose files", built: true }, async () => {
    await openMockDialog(page, "Messy Qualtrics export", ["messy_3header.csv"]);
  });

  await step(page, { tutorial: t, step: 3, file: "03-detection.png", label: "Detection", built: true }, async () => {
    await page.getByTestId("wizard-next").click();
  });

  await step(page, { tutorial: t, step: 4, file: "04-cleanup-pii.png", label: "PII removal", built: true }, async () => {
    await page.getByTestId("wizard-next").click();
  });

  await step(page, { tutorial: t, step: 5, file: "05-cleanup-rows.png", label: "Preview/spam row filters", built: true }, async () => {
    // same screen as step 4; captured separately per the narration script.
  });

  await step(page, { tutorial: t, step: 6, file: "06-cleanup-codes.png", label: "Unusual answer codes", built: true }, async () => {
    await page.getByRole("checkbox", { name: /checked the codes for Q6/ }).check();
  });

  await step(page, { tutorial: t, step: 7, file: "07-review-import.png", label: "Review and import", built: true }, async () => {
    await page.getByTestId("wizard-next").click();
  });

  await step(page, { tutorial: t, step: 8, file: "08-data-grid.png", label: "Cleaned data grid", built: true }, async () => {
    await page.getByTestId("wizard-next").click();
    await skipInterview(page);
  });

  await step(page, { tutorial: t, step: 9, file: "09-missing-summary.png", label: "Missing-data summary", built: true }, async () => {
    // same data screen; missing summary is already visible.
  });

  await step(page, { tutorial: t, step: 10, file: "10-interview-reverse.png", label: "Reverse-score Q5_4", built: true }, async () => {
    await page.getByTestId("tab-variables").click();
    const table = page.getByTestId("variables-table");
    const reverseQ54 = table.getByRole("checkbox", { name: "Reverse-code Q5_4" });
    if (await reverseQ54.isVisible().catch(() => false)) await reverseQ54.check().catch(() => {});
  });

  await step(page, { tutorial: t, step: 11, file: "11-variables-text.png", label: "Variables after import", built: true }, async () => {
    await page.getByTestId("variables-title").waitFor({ state: "visible" });
  });

  await step(
    page,
    {
      tutorial: t,
      step: 12,
      file: "12-qualitative-tagging.png",
      label: "Tag open-ended responses",
      built: true,
    },
    async () => {
      // The Qualitative module (SPEC §11.1) is now built (src/screens/QualitativeScreen.tsx);
      // tag Q10's open-ended responses with a small codebook, as the tutorial narrates.
      await page.getByTestId("tab-qualitative").click();
      await page.getByTestId("qual-title").waitFor({ state: "visible" });
      await page.getByTestId("qual-variable").selectOption("Q10");
      const cards = page.getByTestId("response-card");
      await cards.first().waitFor({ state: "visible" });
      for (const [name, def] of [
        ["Pacing", "Talks about the speed of the course."],
        ["Fairness", ""],
      ]) {
        await page.getByTestId("new-tag").click();
        await page.getByTestId("tag-name").fill(name);
        if (def) await page.getByTestId("tag-definition").fill(def);
        await page.getByTestId("tag-save").click();
      }
      await cards.first().click();
      await page.keyboard.press("1");
      await page.keyboard.press("2");
      await cards.first().getByTestId("tag-chip").first().waitFor({ state: "visible" });
    },
  );
});

// ---------------------------------------------------------------------------
// Tutorial 4: matching-students-across-time (linked_id_prepost)
// ---------------------------------------------------------------------------
test("matching-students-across-time", async ({ page }) => {
  const t = "matching-students-across-time";

  await step(page, { tutorial: t, step: 1, file: "01-home.png", label: "Home", built: true }, async () => {
    await page.goto("/");
  });

  await step(page, { tutorial: t, step: 2, file: "02-choose-files.png", label: "Choose files", built: true }, async () => {
    await openMockDialog(page, "Linked IDs, pre/post", ["pre.csv", "post.csv"]);
  });

  await step(page, { tutorial: t, step: 3, file: "03-detection.png", label: "Detection", built: true }, async () => {
    await page.getByTestId("wizard-next").click();
  });

  await step(page, { tutorial: t, step: 4, file: "04-linking.png", label: "Link people by an ID", built: true }, async () => {
    // Two files -> the wizard also inserts a "Combine time points" step between clean-up and linking.
    await page.getByTestId("wizard-next").click(); // detect -> cleanup
    await page.getByTestId("wizard-next").click(); // cleanup -> stack (combine time points)
    await page.getByTestId("wizard-next").click(); // stack -> link
    const linkStep = page.getByRole("radio", { name: /Link people by an ID/ });
    if (await linkStep.isVisible().catch(() => false)) {
      await linkStep.click();
      const idSelect = page.getByLabel("ID column");
      await idSelect.selectOption({ index: 1 });
    }
  });

  await step(page, { tutorial: t, step: 5, file: "05-review-import.png", label: "Review and import", built: true }, async () => {
    await page.getByTestId("wizard-next").click(); // link -> summary
  });

  await step(page, { tutorial: t, step: 6, file: "06-link-report.png", label: "How the IDs matched", built: true }, async () => {
    await page.getByTestId("wizard-next").click(); // summary "Import" -> commits; link report renders inline
  });

  await step(page, { tutorial: t, step: 7, file: "07-variables-gain.png", label: "Normalized gain variable", built: true }, async () => {
    await page.getByTestId("wizard-next").click(); // summary "Set up variables" -> interview welcome
    await skipInterview(page); // lands on the Data screen
    await page.getByTestId("tab-variables").click();
    await page.getByTestId("variables-title").waitFor({ state: "visible" });
    await page.getByTestId("new-computed").click();
    await page.getByRole("radio", { name: "Normalized gain" }).click();
  });

  await step(page, { tutorial: t, step: 8, file: "08-advisor-question.png", label: "Linked, two time points", built: true }, async () => {
    await page.keyboard.press("Escape"); // close the still-open "New calculated variable" dialog from step 7
    await page.getByTestId("tab-advisor").click();
    await page.getByTestId("advisor-question").waitFor({ state: "visible" });
    await page.getByTestId("advisor-question").getByText("Did scores change over time, or differ between groups?").click();
    await page.getByTestId("advisor-next").click();
    await page.getByTestId("advisor-question").getByText(/Same respondents, measured more than once/).click();
  });

  await step(page, { tutorial: t, step: 9, file: "09-recommendation.png", label: "Recommendation", built: true }, async () => {
    await page.getByTestId("advisor-next").click();
    const twoTimePoints = page.getByTestId("advisor-question").getByText("Two", { exact: true });
    if (await twoTimePoints.isVisible().catch(() => false)) {
      await twoTimePoints.click();
      await page.getByTestId("advisor-next").click();
    }
    await page.getByTestId("recommendation").waitFor({ state: "visible" });
  });

  await step(page, { tutorial: t, step: 10, file: "10-roles.png", label: "Variable roles", built: true }, async () => {
    await page.getByTestId("rec-continue").click();
    await page.getByTestId("flow-run").waitFor({ state: "visible" });
  });

  await step(page, { tutorial: t, step: 11, file: "11-assumption-normality.png", label: "Normality of differences", built: true }, async () => {
    // t_test.paired now has a "long" layout in the mock catalog (outcome + time + subject_id),
    // matching the real engine (SPEC §8, ttests.py) - this stacked/linked dataset needs it since
    // import stacks the two files into one Q4 column plus a Time column rather than two wide columns.
    const longLayout = page.locator("#layout-long");
    if (await longLayout.isVisible().catch(() => false)) await longLayout.click();
    const outcomeRole = page.getByTestId("role-outcome");
    if (await outcomeRole.isVisible().catch(() => false)) await outcomeRole.selectOption("Q4");
    const timeRole = page.getByTestId("role-time");
    if (await timeRole.isVisible().catch(() => false)) await timeRole.selectOption("Time");
    const idRole = page.getByTestId("role-subject_id");
    if (await idRole.isVisible().catch(() => false)) await idRole.selectOption("Q1");
    await page.getByTestId("flow-run").click();
    await page.getByTestId("assumption-progress").waitFor({ state: "visible" });
  });

  await step(page, { tutorial: t, step: 12, file: "12-results.png", label: "Results", built: true }, async () => {
    for (let i = 0; i < 10; i++) {
      const next = page.getByTestId("assumption-next");
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
    }
    await page.getByTestId("decision-suggestion").waitFor({ state: "visible" });
    await page.getByTestId("decision-confirm").click();
    await page.getByTestId("results-view").waitFor({ state: "visible" });
  });
});
