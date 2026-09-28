import { expect, test } from "./fixtures";

/** SPEC §10.3: Export > Report… lets you pick logged tests, then saves a DOCX report through the
 * mock save dialog. */
test("Export > Report: pick a test, export, and see the saved path", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-project").click();
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Attitude items.statly" }).click();
  await expect(page.getByTestId("project-menu")).toContainText("Attitude items");

  await page.getByTestId("export-menu").click();
  await page.getByTestId("export-menu-report").click();

  const dialog = page.getByTestId("report-export-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("report-title")).toHaveValue("Attitude items");
  // Nothing selected yet: export is disabled by an empty Test Log guard rather than a blank report.
  await dialog.getByTestId("report-entry-req_item1").click();

  // The project's one saved Chart Builder chart shows up ticked by default under "Project charts".
  await expect(dialog.getByText("Project charts")).toBeVisible();
  const projectChart = dialog.getByTestId("report-chart-chart_1");
  await expect(projectChart).toBeChecked();
  await dialog.getByTestId("report-format").selectOption("docx");

  await dialog.getByTestId("report-export-run").click();
  await page.getByTestId("mock-dialog").locator("#mock-save-name").fill("Attitude report");
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByText(/Saved to/)).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText(/Attitude report\.docx/)).toBeVisible();
});

/** SPEC §10.3: with no logged tests picked, a ticked project chart alone still exports (the
 * report's "Figures" section is the whole body) -- the bug the owner hit exporting a saved box
 * plot with nothing else selected. */
test("Export > Report: a project chart alone (no tests picked) exports a figure-only PDF", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-project").click();
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Attitude items.statly" }).click();
  await expect(page.getByTestId("project-menu")).toContainText("Attitude items");

  await page.getByTestId("export-menu").click();
  await page.getByTestId("export-menu-report").click();

  const dialog = page.getByTestId("report-export-dialog");
  await expect(dialog).toBeVisible();
  const projectChart = dialog.getByTestId("report-chart-chart_1");
  await expect(projectChart).toBeChecked(); // ticked by default
  await expect(dialog.getByTestId("report-export-run")).toBeEnabled(); // the ticked chart is enough on its own

  // Untick it, then tick it back on: proves the checkbox actually drives selection, not just the default.
  await projectChart.click();
  await expect(projectChart).not.toBeChecked();
  await expect(dialog.getByTestId("report-export-run")).toBeDisabled(); // nothing selected at all now
  await projectChart.click();
  await expect(projectChart).toBeChecked();
  await expect(dialog.getByTestId("report-export-run")).toBeEnabled(); // the chart alone is enough

  await dialog.getByTestId("report-format").selectOption("pdf");
  await dialog.getByTestId("report-export-run").click();
  await page.getByTestId("mock-dialog").locator("#mock-save-name").fill("Box plot figure");
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByText(/Saved to/)).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText(/Box plot figure\.pdf/)).toBeVisible();
});

/** SPEC §10.3: Save figure… on a Results-screen assumption chart covers PNG/SVG/PDF. */
test("Results screen: Save figure… exports the assumption chart as PNG, SVG and PDF", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-project").click();
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Attitude items.statly" }).click();
  await expect(page.getByTestId("project-menu")).toContainText("Attitude items");

  await page.getByTestId("tab-analyses").click();
  await page.getByTestId("log-entry-req_item1").click();
  await expect(page.getByTestId("results-view")).toBeVisible();

  const chartCard = page.getByTestId("chart-qq");
  await expect(chartCard).toBeVisible();
  const saveFigure = chartCard.getByTestId("save-figure");
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
});
