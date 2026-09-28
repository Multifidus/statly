import { expect, test, type Page } from "./fixtures";

/** Capture rich clipboard writes (text/html + text/plain) so the copy payload can be checked. */
async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: Record<string, string>[] };
    w.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          for (const it of items) {
            const out: Record<string, string> = {};
            for (const t of it.types) out[t] = await (await it.getType(t)).text();
            w.__copied.push(out);
          }
        },
        writeText: async (text: string) => void w.__copied.push({ "text/plain": text }),
      },
    });
  });
}

async function importOneGroup(page: Page) {
  await page.goto("/");
  await page.getByTestId("new-project").click();
  await page.getByTestId("choose-files").click();
  const dialog = page.getByTestId("mock-dialog");
  await dialog.getByRole("checkbox", { name: "pre.csv" }).first().check();
  await dialog.getByRole("checkbox", { name: "post.csv" }).first().check();
  await dialog.getByRole("button", { name: "Open" }).click();
  for (let i = 0; i < 10 && !(await page.getByRole("heading", { name: "Welcome" }).isVisible()); i++) {
    await page.getByTestId("wizard-next").click();
    await page.waitForTimeout(150);
  }
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
}

async function finishInterview(page: Page) {
  const heading = page.locator("#interview-title");
  for (let i = 0; i < 80; i++) {
    if ((await heading.textContent()) === "Summary") break;
    await page.getByTestId("interview-next").click();
  }
  await page.getByTestId("interview-next").click(); // Finish
  await expect(page.getByTestId("variables-title")).toBeVisible();
}

test("Test Advisor -> guided assumptions -> results -> copy APA sentence", async ({ page }) => {
  await stubClipboard(page);
  await importOneGroup(page);
  await finishInterview(page);

  // Advisor: outcome pre-selected (the new scale score), one question at a time.
  await page.getByTestId("tab-advisor").click();
  await expect(page.getByTestId("advisor-outcome")).toHaveValue(/_score$/);
  const question = page.getByTestId("advisor-question");
  await expect(question.getByRole("heading", { name: "What do you want to know?" })).toBeFocused();
  await question.getByRole("button", { name: /Why does this matter/ }).click();
  await expect(question.getByText(/shape of your question/)).toBeVisible();
  await question.getByText("Did scores change over time, or differ between groups?").click();
  await page.getByTestId("advisor-next").click();

  // The outcome question was answered from the data: shown pre-filled and changeable.
  await expect(page.getByTestId("path-q_compare_outcome_level")).toHaveAttribute("data-source", "auto");
  await expect(page.getByTestId("path-q_compare_outcome_level")).toContainText("Filled in from your data");
  await page.getByTestId("advisor-question").getByText(/respondents are NOT linked/).click();
  await page.getByTestId("advisor-next").click();

  // Recommendation card.
  const rec = page.getByTestId("recommendation");
  await expect(page.getByTestId("rec-primary")).toHaveText(/Independent-samples t/);
  await expect(page.getByTestId("caveat-aggregate_time_comparison")).toBeVisible();
  await expect(rec).toContainText("Mann-Whitney U");
  await rec.getByRole("button", { name: "Why this test?" }).click();
  await expect(rec.getByText(/each time point is treated as its own group/)).toBeVisible();
  await page.getByTestId("rec-continue").click();

  // Variables pre-filled from roles: scale score by Time.
  await expect(page.getByTestId("role-outcome")).toHaveValue(/_score$/);
  await expect(page.getByTestId("role-group")).toHaveValue("Time");
  await page.getByTestId("flow-run").click();

  // One screen per assumption, with Q-Q + histogram for normality.
  await expect(page.getByTestId("assumption-progress")).toHaveText("Assumption check 1 of 3");
  await expect(page.locator("#assumption-title")).toBeFocused();
  await expect(page.getByTestId("chart-qq").locator("svg").first()).toBeVisible();
  await expect(page.getByTestId("chart-histogram").locator("svg").first()).toBeVisible();
  await expect(page.getByTestId("assumption-verdict")).toBeVisible();
  await page.getByTestId("assumption-next").click();
  await expect(page.getByTestId("assumption-progress")).toHaveText("Assumption check 2 of 3");
  await page.getByTestId("assumption-next").click();
  await expect(page.getByTestId("assumption-progress")).toHaveText("Assumption check 3 of 3");
  await expect(page.locator("#assumption-title")).toContainText("Equal spread");
  await page.getByTestId("assumption-next").click();

  // Decision: Statly suggests, the user chooses.
  await expect(page.getByTestId("decision-suggestion")).toContainText("Statly suggests");
  await page.getByText(/Use the recommended test/).click();
  await page.getByTestId("decision-confirm").click();

  // Results: plain language first, APA sentence, table, How to report this.
  await expect(page.getByTestId("results-view")).toBeVisible();
  await expect(page.getByTestId("plain-summary")).toContainText(/scored/);
  const sentence = page.getByTestId("apa-sentence");
  await expect(sentence).toContainText(/t\(\d+(\.\d+)?\) = -?\d+\.\d\d/);
  await expect(sentence.locator("i", { hasText: /^t$/ }).first()).toBeVisible();
  await expect(page.getByTestId("apa-table")).toContainText("Table 1");
  await expect(page.getByTestId("result-how-to-report")).toContainText("Template");

  await page.getByTestId("copy-sentence").click();
  await expect(page.getByTestId("copy-sentence")).toContainText("Copied");
  const copied = await page.evaluate(() => (window as unknown as { __copied: Record<string, string>[] }).__copied);
  expect(copied).toHaveLength(1);
  expect(copied[0]["text/html"]).toContain("<i>t</i>");
  expect(copied[0]["text/plain"]).toBe(await sentence.textContent());

  // The run is in the Test Log and reopens.
  await page.getByTestId("to-analyses").click();
  const log = page.getByTestId("test-log");
  await expect(log.getByRole("listitem")).toHaveCount(1);
  await log.getByRole("button").first().click();
  await expect(page.getByTestId("results-view")).toBeVisible();

  // Glossary term is keyboard accessible from the results.
  await page.getByTestId("result-summary").getByRole("button", { name: /effect size/i }).first().focus();
  await expect(page.getByTestId("glossary-effect_size")).toBeVisible();
  await page.keyboard.press("Escape");

  // Learn page opens and returns.
  await page.getByTestId("open-learn-page").click();
  await expect(page.getByRole("heading", { name: /Independent-samples t-test/ })).toBeFocused();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("results-view")).toBeVisible();
});

async function importCategorical(page: Page) {
  await page.goto("/");
  await page.getByTestId("new-project").click();
  await page.getByTestId("choose-files").click();
  const dialog = page.getByTestId("mock-dialog");
  await dialog.getByRole("checkbox", { name: "survey.csv" }).check();
  await dialog.getByRole("button", { name: "Open" }).click();
  for (let i = 0; i < 10 && !(await page.getByRole("heading", { name: "Welcome" }).isVisible()); i++) {
    await page.getByTestId("wizard-next").click();
    await page.waitForTimeout(150);
  }
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
}

test("Test Advisor: a categorical outcome (pass/fail) reaches chi-square, not just scores", async ({ page }) => {
  await importCategorical(page);
  await finishInterview(page);

  await page.getByTestId("tab-advisor").click();

  // The outcome dropdown groups a categorical variable (Q3, pass/fail) under "Yes/no and
  // categories", not just scores/ratings, and defaults to it as the outcome.
  const outcomeSelect = page.getByTestId("advisor-outcome");
  const categoryGroup = outcomeSelect.locator('optgroup[label="Yes/no and categories"]');
  await expect(categoryGroup.locator("option")).toContainText(["Q3: Did you pass the course?", "Q4: Did you use an extra-credit opportunity?"]);
  await expect(outcomeSelect).toHaveValue("Q3");

  // "From your data" reads as a yes/no answer, not a generic "category".
  await expect(page.getByText(/your outcome is a yes\/no answer/)).toBeVisible();

  const question = page.getByTestId("advisor-question");
  await question.getByText("Did scores change over time, or differ between groups?").click();
  await page.getByTestId("advisor-next").click();

  // Nominal outcome_level is auto-filled from the data and the tree resolves straight to the
  // chi-square recommendation (no extra design questions, unlike the continuous/ordinal branches).
  await expect(page.getByTestId("path-q_compare_outcome_level")).toHaveAttribute("data-source", "auto");
  const rec = page.getByTestId("recommendation");
  await expect(page.getByTestId("rec-primary")).toHaveText(/Chi-square test of independence/);
  await expect(rec).toContainText("Fisher's exact test");
  await page.getByTestId("rec-continue").click();

  // Row/column roles pre-filled: Q3 (outcome) by Q2 (the dataset's group variable, program).
  await expect(page.getByTestId("role-row")).toHaveValue("Q3");
  await expect(page.getByTestId("role-column")).toHaveValue("Q2");
  await page.getByTestId("flow-run").click();

  // Q3 x Q2 has no small expected counts, so the expected-cell-counts check passes and the
  // decision step still suggests the recommended chi-square test.
  await expect(page.getByTestId("assumption-verdict")).toHaveAttribute("data-verdict", "passed");
  await page.getByTestId("assumption-next").click();
  await expect(page.getByTestId("decision-suggestion")).toContainText("Statly suggests: Chi-square test of independence");
  await page.getByTestId("decision-confirm").click();

  await expect(page.getByTestId("results-view")).toBeVisible();
  await expect(page.getByTestId("apa-sentence")).toContainText(/χ²\(\d+\) = \d+\.\d\d/);
  await expect(page.getByTestId("apa-table")).toContainText("Table 1");
});

test("Test Advisor: chi-square's low-expected-counts check switches the decision step to Fisher's exact test, and the results warning can switch too", async ({ page }) => {
  await importCategorical(page);
  await finishInterview(page);

  await page.getByTestId("tab-advisor").click();

  // Pick Q4 (extra-credit yes/no) as the outcome: sparse against Q3 (pass/fail), 10 Yes / 290 No.
  await page.getByTestId("advisor-outcome").selectOption("Q4");
  const question = page.getByTestId("advisor-question");
  await question.getByText("Did scores change over time, or differ between groups?").click();
  await page.getByTestId("advisor-next").click();

  const rec = page.getByTestId("recommendation");
  await expect(page.getByTestId("rec-primary")).toHaveText(/Chi-square test of independence/);
  await expect(rec).toContainText("Fisher's exact test");
  await page.getByTestId("rec-continue").click();

  await expect(page.getByTestId("role-row")).toHaveValue("Q4");
  await page.getByTestId("role-column").selectOption("Q3");
  await page.getByTestId("flow-run").click();

  // The expected-cell-counts assumption fails for this sparse table.
  await expect(page.getByTestId("assumption-verdict")).toHaveAttribute("data-verdict", "failed");
  await expect(page.locator("#assumption-title")).toContainText("Expected cell counts");
  await expect(page.getByTestId("assumption-verdict")).toContainText(/below 5/);
  await page.getByTestId("assumption-next").click();

  // Fisher's exact test is pre-selected, with the assumption's explanation as the reason.
  await expect(page.getByTestId("decision-suggestion")).toContainText("Statly suggests: Fisher's exact test");
  await expect(page.getByTestId("decision-suggestion")).toContainText(/below 5/);
  await expect(page.locator("#choice-alternative")).toHaveAttribute("data-state", "checked");

  // Override to the recommended chi-square test, to see the results-page warning and its button.
  await page.locator("#choice-recommended").click();
  await page.getByTestId("decision-confirm").click();

  await expect(page.getByTestId("results-view")).toBeVisible();
  await expect(page.getByTestId("apa-sentence")).toContainText("chi-square test of independence");
  const warning = page.getByTestId("result-warnings");
  await expect(warning).toContainText(/below 5/);
  await warning.getByTestId("run-fisher-instead").click();

  // The one-click switch reruns Fisher's exact test on the same Q4 x Q3 table and shows its
  // results, logged as its own Test Log entry.
  await expect(page.getByTestId("apa-sentence")).toContainText("Fisher's exact test");
  await page.getByTestId("to-analyses").click();
  const log = page.getByTestId("test-log");
  await expect(log.getByText(/^Fisher's exact test · Q4/)).toBeVisible();
  await expect(log.getByText(/^Chi-square test of independence · Q4/)).toBeVisible();
});

async function importMessyQualtrics(page: Page) {
  await page.goto("/");
  await page.getByTestId("new-project").click();
  await page.getByTestId("choose-files").click();
  const dialog = page.getByTestId("mock-dialog");
  await dialog.getByRole("checkbox", { name: "messy_3header.csv" }).check();
  await dialog.getByRole("button", { name: "Open" }).click();
  await page.getByTestId("wizard-next").click(); // read files -> detection
  await page.getByTestId("wizard-next").click(); // detection -> clean-up
  await page.getByRole("checkbox", { name: /checked the codes for Q6/ }).check();
  await page.getByTestId("wizard-next").click(); // -> summary
  await page.getByTestId("wizard-next").click(); // import
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
}

test("Test Advisor: correlation asks for the second variable before the tied-ranks question, so a 5-point item reaches Kendall's tau-b (QA-38 #39)", async ({ page }) => {
  await importMessyQualtrics(page);
  await finishInterview(page);

  await page.getByTestId("tab-advisor").click();

  // The Q5 scale score (continuous) is pre-selected as the outcome.
  await expect(page.getByTestId("advisor-outcome")).toHaveValue(/_score$/);

  const question = page.getByTestId("advisor-question");
  await question.getByText("Are two things related?").click();
  await page.getByTestId("advisor-next").click();

  // Before any further relate-branch question, Statly asks which other variable - the outcome
  // itself is not offered.
  const picker = page.getByTestId("advisor-second-variable");
  await expect(picker).toBeVisible();
  const pickerSelect = page.getByTestId("advisor-second-variable-select");
  await expect(pickerSelect.locator("option", { hasText: /^Q6/ })).toHaveCount(1);
  const outcomeValue = await page.getByTestId("advisor-outcome").inputValue();
  await expect(pickerSelect.locator(`option[value="${outcomeValue}"]`)).toHaveCount(0);

  await pickerSelect.selectOption("Q6");

  // "What kind of variables are you relating?" is filled in from both variables' levels (one
  // ordinal), and the tied-ranks question sees Q6's own 5 distinct values (not the outcome's
  // much larger distinct count, the old bug), landing straight on Kendall's tau-b.
  await expect(page.getByTestId("path-q_relate_variable_types")).toContainText("Filled in from your data");
  await expect(page.getByTestId("recommendation")).toBeVisible();
  await expect(page.getByTestId("rec-primary")).toHaveText(/Kendall's tau-b/);
});
