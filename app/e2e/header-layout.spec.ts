import { expect, test } from "./fixtures";

/** Bounding boxes for two elements overlap (share screen space), not just occupy the same row. */
function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test.describe("header layout at common desktop widths", () => {
  test("autosave status never overlaps Export, and dataset tabs stay single-line", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome to Statly" })).toBeVisible();

    // Home -> New project -> import a file through the wizard so the header shows the full set
    // of controls at once: Project menu + dirty status, Export, and the dataset tabs (Test Log
    // is the tab most likely to wrap, since its label is two words).
    await page.getByTestId("new-project").click();
    await page.getByTestId("choose-files").click();
    const dialog = page.getByTestId("mock-dialog");
    await dialog.getByRole("checkbox", { name: "messy_3header.csv" }).check();
    await dialog.getByRole("button", { name: "Open" }).click();
    await page.getByTestId("wizard-next").click(); // -> detect
    await page.getByTestId("wizard-next").click(); // -> cleanup
    await page.getByRole("checkbox", { name: /checked the codes for Q6/ }).check();
    await page.getByTestId("wizard-next").click(); // -> summary
    await page.getByTestId("wizard-next").click(); // -> import + interview
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByTestId("data-title")).toBeVisible();

    const status = page.getByTestId("autosave-status");
    await expect(status).toHaveText(/unsaved changes|not saved yet/i);

    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });

      const statusBox = await status.boundingBox();
      const exportBox = await page.getByTestId("export-menu").boundingBox();
      expect(statusBox).not.toBeNull();
      expect(exportBox).not.toBeNull();
      expect(overlaps(statusBox!, exportBox!), `status overlaps Export at ${width}px`).toBe(false);

      // Every dataset tab renders on one line: its box height matches the shortest label's
      // ("Data"), which never wraps. A wrapped "Test Log" would be roughly double the height.
      const dataBox = await page.getByTestId("tab-data").boundingBox();
      const testLogBox = await page.getByTestId("tab-analyses").boundingBox();
      expect(dataBox).not.toBeNull();
      expect(testLogBox).not.toBeNull();
      expect(testLogBox!.height, `Test Log tab wrapped at ${width}px`).toBeLessThanOrEqual(dataBox!.height + 2);
    }
  });
});
