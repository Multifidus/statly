import { expect, test } from "./fixtures";

/** SPEC §10.2: build a bar chart with error bars from shelves, switch to the APA preset, save, reopen. */
test("Chart builder: bar chart with error bars, APA preset, saved in the project", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-project").click();
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Example project.statly" }).click();
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  await page.getByTestId("tab-charts").click();
  await expect(page.getByTestId("charts-list")).toBeVisible(); // the example project ships one saved chart

  await page.getByTestId("new-chart").click();
  const builder = page.getByTestId("chart-builder");
  await expect(builder).toBeVisible();

  // Helper: "Compare groups" suggests a bar chart.
  await page.getByTestId("goal-compare_groups").click();
  await expect(page.getByTestId("suggest-bar")).toContainText("Bar chart with error bars");
  await expect(page.getByTestId("chart-missing")).toContainText("Drag a score to Y");

  // Drag a grouping onto X with the mouse...
  const chip = page.getByTestId("var-chip-Time");
  const shelfX = page.getByTestId("shelf-x");
  await chip.scrollIntoViewIfNeeded();
  const from = (await chip.boundingBox())!;
  const box = (await shelfX.boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId("pill-x-Time")).toBeVisible();

  // ...and put the score on Y with the keyboard-accessible menu.
  await page.getByTestId("add-math_attitude").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("add-to-x")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("add-to-y")).toBeFocused();
  // Radix ignores a select that lands while its open animation is still settling; retry the key.
  await expect(async () => {
    if (await page.getByTestId("add-to-y").isVisible()) await page.getByTestId("add-to-y").press("Enter");
    await expect(page.getByTestId("pill-y-math_attitude")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 8000 });
  await expect(page.getByTestId("pill-y-math_attitude")).toBeVisible();

  const chart = page.getByTestId("builder-chart");
  await expect(chart.locator("svg")).toBeVisible();
  await expect(chart).toContainText("95% CI");
  await page.getByTestId("error-bars").selectOption("se");
  await expect(chart).toContainText("±1 SE");

  // Save figure… (SPEC §10.3): PNG/SVG/PDF straight off the live Vega view, no AnalysisResult needed.
  const saveFigure = page.getByTestId("save-figure");
  await expect(saveFigure).toBeVisible();
  async function saveAs(itemName: RegExp | string, ext: string) {
    await saveFigure.click();
    await page.getByRole("menuitem", { name: itemName }).click();
    await page.getByTestId("mock-dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.locator('[role="status"].pointer-events-auto')).toContainText(new RegExp(`Saved .*\\.${ext}`));
  }
  await saveAs(/PNG \(300 DPI\)/, "png");
  await saveAs("SVG (vector)", "svg");
  await saveAs("PDF", "pdf");

  // Show the numbers.
  await page.getByTestId("chart-numbers").locator("summary").click();
  await expect(page.getByTestId("chart-numbers").locator("table")).toContainText("SE");

  // APA preset: figure number + italic title, no gridlines.
  await page.getByTestId("preset-apa").click();
  await expect(page.getByTestId("apa-options")).toBeVisible();
  await page.getByTestId("chart-title").fill("Math attitude by time point");
  await page.getByTestId("figure-note").fill("Error bars show ±1 SE.");
  await expect(chart).toContainText("Figure 2");
  await expect(chart).toContainText("Math attitude by time point");
  await expect(chart).toContainText("Note. Error bars show ±1 SE.");
  await expect(page.getByTestId("gridlines")).not.toBeChecked();

  // Light/dark preview.
  await page.getByTestId("preview-dark").click();
  await expect(page.locator("[data-theme-preview=dark]")).toBeVisible();
  await page.getByTestId("preview-light").click();

  await page.getByTestId("chart-save").click();
  await expect(page.getByTestId("chart-saved")).toBeVisible();
  await page.getByTestId("back-to-charts").click();
  await expect(page.getByTestId("charts-list")).toContainText("Math attitude by time point");

  // Save the project, open another, then reopen: the chart spec comes back.
  await page.getByTestId("project-menu").click();
  await page.getByRole("menuitem", { name: /Save as/i }).click();
  await page.getByLabel("File name").fill("Charts");
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("autosave-status")).toHaveText("All changes saved");
  await page.getByTestId("project-menu").click();
  await page.getByRole("menuitem", { name: /Open/ }).click();
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Example project.statly" }).click();
  await expect(page.getByTestId("project-menu")).toContainText("Math attitude study");
  await page.getByTestId("project-menu").click();
  await page.getByRole("menuitem", { name: /Open/ }).click();
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Charts.statly" }).click();
  await expect(page.getByTestId("project-menu")).toContainText("Charts");
  await page.getByTestId("tab-charts").click();
  const list = page.getByTestId("charts-list");
  await expect(list).toContainText("Math attitude by time point");
  await list.locator("[data-testid^=open-chart-]", { hasText: "Math attitude by time point" }).click();
  await expect(page.getByTestId("preset-apa")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("builder-chart")).toContainText("Figure 2");
  await expect(page.getByTestId("error-bars")).toHaveValue("se");
  await page.screenshot({ path: test.info().outputPath("chart-builder.png"), fullPage: true });
});
