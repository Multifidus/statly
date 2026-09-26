import { expect, test, type Page } from "@playwright/test";

async function pick(page: Page, heading: string, option: string | RegExp) {
  const q = page.getByTestId("planner-question");
  await expect(q.getByRole("heading", { name: heading })).toBeFocused();
  await q.getByText(option).click();
  await page.getByTestId("planner-next").click();
}

/** Study Planner (SPEC §11.2) in mock mode: describe -> interview -> power -> plan -> DOCX + project. */
test("plan a study, export it and start a project from it", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("plan-study").click();
  await expect(page.getByRole("heading", { name: "Study Planner" })).toBeVisible();

  await page.getByTestId("plan-title-input").fill("Math attitude study");
  await page.getByTestId("plan-rq-input").fill("Do students in the new program feel better about math?");
  await page.getByTestId("planner-begin").click();

  // Every question is asked (no dataset): nothing is pre-filled.
  await pick(page, "What do you want to know?", "Did scores change over time, or differ between groups?");
  await pick(page, "What is your outcome (the thing you're comparing)?", /A score, like a test total/);
  await pick(page, "What are you comparing?", /Independent groups/);
  await pick(page, "How many groups?", "Two");
  const rec = page.getByTestId("planner-recommendation");
  await expect(rec).toContainText(/t.test/i);
  await page.getByTestId("planner-to-power").click();

  // Power step
  await expect(page.getByTestId("power-mapping-note")).toContainText("two separate groups");
  await page.getByTestId("effect-medium").click();
  await page.getByTestId("power-run").click();
  await expect(page.getByTestId("power-n-total")).toHaveText("128");
  await expect(page.getByTestId("power-recruit")).toContainText("143");
  await expect(page.getByTestId("power-curve")).toBeVisible();
  await expect(page.getByTestId("power-benchmarks")).toContainText("Small");
  await page.getByLabel(/People you can realistically get/).fill("30");
  await page.getByTestId("sensitivity-run").click();
  await expect(page.getByTestId("sensitivity-result")).toContainText(/d = 0\.7/);
  await page.getByTestId("planner-to-plan").click();

  // Plan
  await expect(page.getByTestId("plan-title")).toHaveText("Math attitude study");
  await expect(page.getByTestId("plan-design")).toContainText("Planned analysis:");
  await expect(page.getByTestId("plan-power")).toContainText("128 people in total");
  await expect(page.getByTestId("plan-recommendations")).toContainText("recode values");
  await expect(page.getByTestId("plan-recommendations")).toContainText("Survey Preview");
  await expect(page.getByTestId("plan-assumptions")).toContainText(/Normality/);

  // Export DOCX
  await page.getByTestId("plan-export").click();
  const dialog = page.getByTestId("mock-dialog");
  await expect(dialog.locator("#mock-save-name")).toHaveValue("Math attitude study - study plan.docx");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("plan-exported")).toContainText("Math attitude study - study plan.docx");

  // Start an analysis project from the plan -> import screen with the new project.
  await page.getByTestId("plan-start-project").click();
  await expect(page.getByTestId("project-menu")).toContainText("Math attitude study");
});
