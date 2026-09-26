import { expect, test } from "./fixtures";

/** SPEC §9: suggested family -> guided method choice -> adjusted p beside the original -> save/reopen. */
test("Test Log: group related tests, choose a correction, and keep adjusted p across save/reopen", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-project").click();
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Attitude items.statly" }).click();
  await expect(page.getByTestId("project-menu")).toContainText("Attitude items");
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  await page.getByTestId("tab-analyses").click();

  const screen = page.getByTestId("analyses-screen");
  await expect(screen.getByRole("heading", { name: "Test Log" })).toBeVisible();
  await expect(page.getByTestId("test-log").getByRole("listitem")).toHaveCount(4);

  // The false-positive problem, with the concrete example; post hoc tests explained separately.
  await screen.getByRole("button", { name: /Why grouping them matters/ }).click();
  await expect(page.getByTestId("false-positive-explainer").first()).toContainText("40%");
  await expect(page.getByTestId("posthoc-note")).toContainText("already applies its own correction");

  // Statly suggests a family but applies nothing on its own.
  const suggestion = page.getByTestId("family-suggestion");
  await expect(suggestion).toHaveCount(1);
  await expect(suggestion).toContainText("3 Independent-samples t test (Welch) tests");
  await expect(page.locator("[data-testid^=adjusted-p-]")).toHaveCount(0);
  await suggestion.getByTestId("suggestion-group").click();

  const dialog = page.getByTestId("family-dialog");
  await expect(dialog.getByTestId("family-name")).toHaveValue("Independent-samples t test (Welch) tests");
  await expect(dialog.getByTestId("family-member-req_tukey")).toBeDisabled();
  await expect(dialog.getByText(/Post hoc comparisons already correct/)).toBeVisible();
  await dialog.getByTestId("family-member-req_scale").uncheck();
  await dialog.getByTestId("family-name").fill("Attitude items");
  await expect(dialog.getByTestId("family-save")).toBeDisabled(); // no method chosen yet
  await expect(dialog.getByTestId("method-holm")).toContainText("When to choose it");
  await expect(dialog.getByTestId("method-fdr_bh")).toContainText("false discovery rate");
  await dialog.getByTestId("method-holm").getByRole("radio").click();
  await dialog.getByTestId("family-save").click();
  await expect(dialog).toBeHidden();

  // Adjusted p beside the original: Holm on .012, .034 -> .024, .034.
  const family = page.getByTestId("family-fam_1");
  await expect(family).toContainText("Attitude items");
  await expect(page.getByTestId("family-row-req_item1")).toContainText(".012");
  await expect(page.getByTestId("family-row-req_item1")).toContainText(".024");
  await expect(page.getByTestId("adjusted-p-req_item1")).toContainText("Holm-adjusted p = .024");

  // Changing the method re-adjusts at once.
  await page.getByTestId("family-method-fam_1").selectOption("bonferroni");
  await expect(page.getByTestId("adjusted-p-req_item2")).toContainText("Bonferroni-adjusted p = .068");
  await page.getByTestId("family-method-fam_1").selectOption("holm");
  await expect(page.getByTestId("adjusted-p-req_item2")).toContainText("Holm-adjusted p = .034");

  // Save as a new file, open another project, then reopen this one.
  await page.getByTestId("project-menu").click();
  await page.getByRole("menuitem", { name: /Save as/i }).click();
  await page.getByLabel("File name").fill("Families");
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("autosave-status")).toHaveText("All changes saved");

  await page.getByTestId("project-menu").click();
  await page.getByRole("menuitem", { name: /Open/ }).click();
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Example project.statly" }).click();
  await expect(page.getByTestId("project-menu")).toContainText("Math attitude study");
  await page.getByTestId("project-menu").click();
  await page.getByRole("menuitem", { name: /Open/ }).click();
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Families.statly" }).click();
  await expect(page.getByTestId("project-menu")).toContainText("Families");
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  await page.getByTestId("tab-analyses").click();
  await expect(page.getByTestId("adjusted-p-req_item1")).toContainText("Holm-adjusted p = .024");
  await expect(page.getByTestId("family-method-fam_1")).toHaveValue("holm");

  // The results view shows the family badge for a member.
  await page.getByTestId("log-entry-req_item1").click();
  await expect(page.getByTestId("results-view")).toBeVisible();
  await expect(page.getByTestId("family-badge")).toContainText("Part of family “Attitude items”, Holm-adjusted p = .024");
});
