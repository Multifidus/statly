import { expect, test, type Page } from "./fixtures";

async function importMessy(page: Page) {
  await page.goto("/");
  await page.getByTestId("new-project").click();
  await page.getByTestId("choose-files").click();
  const dialog = page.getByTestId("mock-dialog");
  await dialog.getByRole("checkbox", { name: "messy_3header.csv" }).check();
  await dialog.getByRole("button", { name: "Open" }).click();
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-next").click();
  await page.getByRole("checkbox", { name: /checked the codes for Q6/ }).check();
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-next").click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByTestId("data-title")).toBeVisible();
}

test("reads, tags, searches, summarizes, and exports open-ended responses", async ({ page }) => {
  await importMessy(page);
  await page.getByTestId("tab-qualitative").click();
  await expect(page.getByTestId("qual-title")).toBeVisible();
  await page.getByTestId("qual-variable").selectOption("Q10");
  await expect(page.getByTestId("qual-count")).toContainText("written answers to Q10");
  const cards = page.getByTestId("response-card");
  await expect(cards.first()).toBeVisible();

  // Codebook: two tags.
  for (const [name, def] of [["Pacing", "Talks about the speed of the course."], ["Fairness", ""]]) {
    await page.getByTestId("new-tag").click();
    await page.getByTestId("tag-name").fill(name);
    if (def) await page.getByTestId("tag-definition").fill(def);
    await page.getByTestId("tag-save").click();
  }
  await expect(page.getByTestId("codebook-tag")).toHaveCount(2);

  // Keyboard tagging: focus the first response, press 1 and 2; arrow down, press 1.
  await cards.first().click();
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  await expect(cards.first().getByTestId("tag-chip")).toHaveText(["Pacing", "Fairness"]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("1");
  await expect(cards.nth(1).getByTestId("tag-chip")).toHaveText(["Pacing"]);
  // Remove a tag with its chip button.
  await cards.first().getByRole("button", { name: "Remove tag Fairness" }).click();
  await expect(cards.first().getByTestId("tag-chip")).toHaveText(["Pacing"]);
  // Tag through the menu too.
  await cards.nth(2).getByTestId("tag-menu").click();
  await page.getByRole("menuitemcheckbox", { name: /Fairness/ }).click();
  await page.keyboard.press("Escape");
  await expect(cards.nth(2).getByTestId("tag-chip")).toHaveText(["Fairness"]);

  // Search highlights matches.
  await page.getByTestId("qual-search").fill("pace");
  await expect(cards.first().locator("mark").first()).toHaveText(/pace/i);
  await page.getByTestId("qual-search").fill("");
  await page.getByTestId("qual-tag-filter").selectOption({ label: "Tagged “Pacing”" });
  await expect(page.getByTestId("qual-count")).toContainText("Showing 2 of");
  await page.getByTestId("qual-tag-filter").selectOption({ label: "All responses" });

  // Summary: overall and by Q6, then yes/no variables.
  await page.getByTestId("qual-tab-summary").click();
  const table = page.getByTestId("qual-summary-table");
  await expect(table.getByRole("row", { name: /Pacing/ })).toContainText("2 (");
  await page.getByTestId("qual-summary-by").selectOption("Q6");
  await expect(table.getByRole("columnheader")).not.toHaveCount(2);
  await expect(page.getByTestId("tag-chart")).toBeVisible();
  await page.getByTestId("make-yes-no").click();
  await expect(page.getByTestId("yes-no-created")).toContainText("Q10_pacing");
  await expect(page.getByTestId("yes-no-created")).toContainText("chi-square");

  // Export coded responses (mock save dialog).
  await page.getByTestId("qual-export").click();
  await page.getByRole("menuitem", { name: /Coded responses \(Excel/ }).click();
  await page.getByTestId("mock-dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Saved .*\.xlsx/ })).toBeVisible();
});
