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

test("numbers + words exports of the same survey import as one labelled dataset", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-project").click();
  await page.getByTestId("choose-files").click();
  const dialog = page.getByTestId("mock-dialog");
  await dialog.getByRole("checkbox", { name: "messy_3header.csv" }).check();
  await dialog.getByRole("checkbox", { name: "messy_text_choices.csv" }).check();
  await dialog.getByRole("button", { name: "Open" }).click();

  // Check step: the pair is explained and the words file is set aside for labels.
  await page.getByTestId("wizard-next").click();
  await expect(page.getByRole("heading", { name: "Check how we read them" })).toBeFocused();
  await expect(page.getByText(/same responses exported twice, once with numbers and once with words/)).toBeVisible();
  await expect(page.getByTestId("labels-file")).toContainText("messy_text_choices.csv");
  // No time-point steps for a pair.
  const steps = page.getByRole("navigation", { name: "Import steps" });
  await expect(steps.getByRole("button", { name: /Combine time points/ })).toHaveCount(0);
  await expect(page.getByText("Step 2 of 4")).toBeVisible();

  await page.getByTestId("wizard-next").click();
  await expect(page.getByRole("heading", { name: "Survey clean-up" })).toBeVisible();
  await page.getByRole("checkbox", { name: /checked the codes for Q6/ }).check();
  await page.getByTestId("wizard-next").click();
  await expect(page.getByRole("heading", { name: "Review and import" })).toBeVisible();
  await expect(page.getByText(/words from messy_text_choices\.csv attached to the numbers/)).toBeVisible();
  await expect(page.getByText("113 rows", { exact: true })).toBeVisible();
  await page.getByTestId("wizard-next").click();

  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByTestId("data-counts")).toContainText("108 rows");
  await expect(page.getByTestId("data-grid").getByRole("columnheader", { name: /Time/ })).toHaveCount(0);
});

test("a Qualtrics survey file (.qsf) added on the first step is matched and stored with the import", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-project").click();
  await page.getByTestId("choose-files").click();
  let dialog = page.getByTestId("mock-dialog");
  await dialog.getByRole("checkbox", { name: "messy_3header.csv" }).check();
  await dialog.getByRole("button", { name: "Open" }).click();

  // Optional survey picker below the data files.
  const survey = page.getByTestId("survey-file");
  await expect(survey.getByRole("heading", { name: "Add your survey file (.qsf)" })).toBeVisible();
  await expect(survey).toContainText("Tools → Import/Export → Export Survey");
  // A data file picked by mistake is refused with a plain explanation.
  await page.getByTestId("choose-survey").click();
  dialog = page.getByTestId("mock-dialog");
  await dialog.getByRole("checkbox", { name: "messy_2header.csv" }).check();
  await dialog.getByRole("button", { name: "Open" }).click();
  await expect(survey.getByRole("alert")).toContainText("doesn't look like a Qualtrics survey");
  await page.getByTestId("choose-survey").click();
  dialog = page.getByTestId("mock-dialog");
  await dialog.getByRole("checkbox", { name: "survey.qsf" }).check();
  await dialog.getByRole("button", { name: "Open" }).click();
  await expect(page.getByTestId("survey-file-chosen")).toContainText("Course Experience Survey – Fall");
  await expect(page.getByTestId("survey-file-chosen")).toContainText("7 questions");
  // Remove, then add again.
  await page.getByRole("button", { name: "Remove survey.qsf" }).click();
  await expect(page.getByTestId("survey-file-chosen")).toHaveCount(0);
  await page.getByTestId("choose-survey").click();
  dialog = page.getByTestId("mock-dialog");
  await dialog.getByRole("checkbox", { name: "survey.qsf" }).check();
  await dialog.getByRole("button", { name: "Open" }).click();
  await expect(page.getByTestId("survey-file-chosen")).toBeVisible();

  await page.getByTestId("wizard-next").click();
  await expect(page.getByRole("heading", { name: "Check how we read them" })).toBeFocused();
  await page.getByTestId("wizard-next").click();
  await page.getByRole("checkbox", { name: /checked the codes for Q6/ }).check();
  await page.getByTestId("wizard-next").click();
  await expect(page.getByRole("heading", { name: "Review and import" })).toBeVisible();
  await expect(page.getByText(/^Course Experience Survey – Fall, \d+ questions matched/)).toBeVisible();

  await page.getByTestId("wizard-next").click();
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
});
