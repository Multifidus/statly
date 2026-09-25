import { expect, test, type Page } from "@playwright/test";

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
