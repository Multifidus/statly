import { expect, test } from "./fixtures";

test("imports the messy Qualtrics export through the wizard and reaches the data grid", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to Statly" })).toBeVisible();

  // Home -> New project -> Step 1: pick the file (mock file dialog).
  await page.getByTestId("new-project").click();
  await expect(page.getByRole("heading", { name: "Choose files" })).toBeVisible();
  await page.getByTestId("choose-files").click();
  const dialog = page.getByTestId("mock-dialog");
  await dialog.getByRole("checkbox", { name: "messy_3header.csv" }).check();
  await dialog.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("list", { name: "Files to import" })).toContainText("messy_3header.csv");

  // Step 2: detection results.
  await page.getByTestId("wizard-next").click();
  await expect(page.getByRole("heading", { name: "Check how we read them" })).toBeFocused();
  await expect(page.getByText("Qualtrics export", { exact: true })).toBeVisible();
  await expect(page.getByText(/3 header rows/)).toBeVisible();
  await expect(page.getByText("UTF-8 (with byte-order mark)")).toBeVisible();
  await expect(page.getByText("113 rows, 34 columns")).toBeVisible();

  // Step 3: Qualtrics clean-up decisions.
  await page.getByTestId("wizard-next").click();
  await expect(page.getByRole("heading", { name: "Survey clean-up" })).toBeVisible();
  await expect(page.getByText(/FERPA/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Remove IPAddress/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Survey Preview.*Spam/ })).toBeChecked();
  // Blocked until the non-contiguous Q6 codes are acknowledged.
  await expect(page.getByTestId("wizard-next")).toBeDisabled();
  await expect(page.getByText("Confirm the unusual answer codes.")).toBeVisible();
  await page.getByRole("checkbox", { name: /checked the codes for Q6/ }).check();
  await page.getByRole("button", { name: /Why does this matter/ }).click();
  await expect(page.getByText(/test runs you made/)).toBeVisible();

  // Step 4 (single file): summary, then import.
  await page.getByTestId("wizard-next").click();
  await expect(page.getByRole("heading", { name: "Review and import" })).toBeVisible();
  await expect(page.getByText("113 rows", { exact: true })).toBeVisible();
  await page.getByTestId("wizard-next").click();

  // The Variable Interview starts after import; skip it to reach the data grid.
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();

  // Data screen: grid + missing-data summary.
  await expect(page.getByTestId("data-title")).toBeVisible();
  await expect(page.getByTestId("data-counts")).toContainText("108 rows");
  const grid = page.getByTestId("data-grid");
  await expect(grid).toBeVisible();
  await expect(grid.getByRole("columnheader", { name: /^Q1/ }).first()).toBeVisible();
  // PII columns were dropped; metadata hidden by default.
  await expect(grid.getByRole("columnheader", { name: /IPAddress/ })).toHaveCount(0);
  await expect(grid.getByRole("columnheader", { name: /StartDate/ })).toHaveCount(0);
  // Rows arrive from dataset.rows pages.
  await expect(grid.getByRole("rowheader", { name: "1", exact: true })).toBeVisible();
  await expect(grid.getByRole("gridcell").first()).not.toHaveText("…");
  await expect(page.getByTestId("missing-summary")).toContainText("Q5_1");

  // Metadata toggle shows the hidden survey columns.
  await page.getByRole("checkbox", { name: /Show survey system columns/ }).check();
  await expect(grid.getByRole("columnheader", { name: /StartDate/ })).toBeVisible();

  // Keyboard: the grid is focusable and arrow keys move the active cell.
  await grid.focus();
  await page.keyboard.press("ArrowDown");
  await expect(grid).toHaveAttribute("aria-activedescendant", /-1-0$/);

  // Save via the project menu (mock save dialog); unsaved indicator clears.
  await expect(page.getByTestId("autosave-status")).toContainText("Unsaved changes");
  await page.getByTestId("project-menu").click();
  await page.getByRole("menuitem", { name: /^Save\b/ }).first().click();
  await page.getByLabel("File name").fill("Messy study");
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("autosave-status")).toHaveText("All changes saved");
  await expect(page.getByTestId("project-menu")).toContainText("Messy study");
});
