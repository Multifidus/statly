import { expect, test, type Page } from "@playwright/test";

async function importMessy(page: Page) {
  await page.goto("/");
  await page.getByTestId("new-project").click();
  await page.getByTestId("choose-files").click();
  const dialog = page.getByTestId("mock-dialog");
  await dialog.getByRole("checkbox", { name: "messy_3header.csv" }).check();
  await dialog.getByRole("button", { name: "Open" }).click();
  await page.getByTestId("wizard-next").click(); // read files
  await page.getByTestId("wizard-next").click(); // detection -> clean-up
  await page.getByRole("checkbox", { name: /checked the codes for Q6/ }).check();
  await page.getByTestId("wizard-next").click(); // -> summary
  await page.getByTestId("wizard-next").click(); // import
}

/** Press Continue until the step heading reads `title` (the pre-filled guesses are accepted). */
async function continueUntil(page: Page, title: string) {
  const heading = page.locator("#interview-title");
  for (let i = 0; i < 60; i++) {
    if ((await heading.textContent()) === title) return;
    await page.getByTestId("interview-next").click();
  }
  throw new Error(`never reached step "${title}"`);
}

test("completes the Variable Interview, edits a variable, then undoes the edit", async ({ page }) => {
  await importMessy(page);

  // Interview: one question at a time, each with a "Why does this matter?" expander.
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await page.getByTestId("interview-next").click();
  await expect(page.getByRole("heading", { name: "What is each question?" })).toBeFocused();
  await expect(page.getByTestId("unit-card")).toBeVisible();
  await page.getByRole("button", { name: /Why does this matter/ }).click();
  await expect(page.getByText(/pick the right test later/)).toBeVisible();

  // The Q5 matrix is suggested as a scale; mark Q5_4 as negatively worded.
  await continueUntil(page, "Scales");
  const q54 = page.getByTestId("scale-item-Q5_4");
  await expect(q54).toBeVisible();
  await q54.getByRole("checkbox", { name: /Negatively worded/ }).check();
  // Keyboard alternative to dragging: move an item out and back with its Scale menu.
  await page.getByRole("combobox", { name: "Scale for Q5_6" }).selectOption({ label: "Not in a scale" });
  await expect(page.getByRole("list", { name: "Questions not in a scale" })).toContainText("Q5_6");
  await page.getByRole("combobox", { name: "Scale for Q5_6" }).selectOption({ index: 1 });

  await continueUntil(page, "Scale scores");
  await expect(page.getByRole("spinbutton", { name: /Minimum answered questions/ })).toHaveValue("3");
  await continueUntil(page, "Summary");
  await expect(page.getByText(/reverse-scored: Q5_4/)).toBeVisible();
  await page.getByTestId("interview-next").click(); // Finish

  // Variables screen: the scale score exists and Q5_4 is reverse-coded.
  await expect(page.getByTestId("variables-title")).toBeVisible();
  const table = page.getByTestId("variables-table");
  await expect(table.locator('[data-testid^="var-row-Q5"][data-testid$="_score"]')).toBeVisible();
  await expect(table.getByRole("checkbox", { name: "Reverse-code Q5_4" })).toBeChecked();
  await expect(page.getByTestId("scales-list")).toContainText(/→ Q5\w*_score/);

  // Edit a variable inline, then undo it with the button and redo with the keyboard.
  const role = table.getByRole("combobox", { name: "Role of Q1", exact: true });
  const before = await role.inputValue();
  await role.selectOption("ignore");
  await expect(role).toHaveValue("ignore");
  await expect(page.getByTestId("history-list")).toContainText("Changed role of Q1");
  await page.getByTestId("undo").click();
  await expect(role).toHaveValue(before);
  await page.getByTestId("variables-title").click();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(role).toHaveValue("ignore");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(role).toHaveValue(before);

  // Inline text edit + undo.
  const label = table.getByRole("textbox", { name: "Label for Q1", exact: true });
  const labelBefore = await label.inputValue();
  await label.fill("Consent given");
  await label.press("Enter");
  await expect(page.getByTestId("history-list")).toContainText("Changed label of Q1");
  await page.getByTestId("undo").click();
  await expect(label).toHaveValue(labelBefore);
});
