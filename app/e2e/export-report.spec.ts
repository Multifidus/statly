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
  await dialog.getByTestId("report-format").selectOption("docx");

  await dialog.getByTestId("report-export-run").click();
  await page.getByTestId("mock-dialog").locator("#mock-save-name").fill("Attitude report");
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByText(/Saved to/)).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText(/Attitude report\.docx/)).toBeVisible();
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
