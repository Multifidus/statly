import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepCleanup } from "@/components/import/StepCleanup";
import { findResponseSets } from "@/lib/importLogic";
import { useImportFlow } from "@/stores/importFlow";
import { MESSY, MESSY_TEXT, useFreshMock } from "@/test/mockTransport";

async function load(path: string) {
  useFreshMock();
  useImportFlow.getState().addFiles([path]);
  await useImportFlow.getState().runPreview();
}

describe("StepCleanup (Qualtrics decisions)", () => {
  beforeEach(async () => load(MESSY));

  it("shows PII columns checked for removal with a FERPA/IRB explanation, and can keep one", async () => {
    const user = userEvent.setup();
    render(<StepCleanup />);
    expect(screen.getByText(/FERPA/)).toBeInTheDocument();
    expect(screen.getByText(/IRB/)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: /personal information/i });
    const boxes = within(list).getAllByRole("checkbox");
    expect(boxes).toHaveLength(6);
    boxes.forEach((b) => expect(b).toBeChecked());
    await user.click(within(list).getByRole("checkbox", { name: /RecipientEmail/ }));
    expect(useImportFlow.getState().decisions!.dropColumns).not.toContain("RecipientEmail");
  });

  it("lists row filters with the number of rows each removes", async () => {
    const user = userEvent.setup();
    render(<StepCleanup />);
    const status = screen.getByRole("checkbox", { name: /Survey Preview.*Spam.*5 rows/ });
    const unfinished = screen.getByRole("checkbox", { name: /unfinished responses.*8 rows/ });
    expect(status).toBeChecked();
    expect(unfinished).not.toBeChecked();
    await user.click(unfinished);
    const d = useImportFlow.getState().decisions!;
    expect(Object.values(d.enabledFilters).filter(Boolean)).toHaveLength(2);

    await user.click(screen.getByRole("checkbox", { name: /didn't get far enough/ }));
    const input = screen.getByRole("spinbutton", { name: /progress of at least/ });
    await user.clear(input);
    await user.type(input, "75");
    expect(useImportFlow.getState().decisions!.progressThreshold).toBe(75);
  });

  it("offers the multi-select split, hides metadata by default, and needs the Q6 code check", async () => {
    const user = userEvent.setup();
    render(<StepCleanup />);
    expect(screen.getByRole("checkbox", { name: /Split Q7 into yes\/no columns/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Hide survey system columns/ })).toBeChecked();
    expect(screen.getByText("1, 2, 4, 5, 7")).toBeInTheDocument();
    const ack = screen.getByRole("checkbox", { name: /checked the codes for Q6/ });
    await user.click(ack);
    expect(useImportFlow.getState().decisions!.noncontiguousAck.Q6).toBe(true);
    expect(screen.getByRole("heading", { name: /Missing-answer codes/ })).toBeInTheDocument();
  });

  it("has a 'Why does this matter?' expander", async () => {
    const user = userEvent.setup();
    render(<StepCleanup />);
    const why = screen.getByRole("button", { name: /Why does this matter/ });
    expect(why).toHaveAttribute("aria-expanded", "false");
    await user.click(why);
    expect(why).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/test runs you made/)).toBeVisible();
  });
});

describe("StepCleanup (text-choice export)", () => {
  beforeEach(async () => load(MESSY_TEXT));

  it("lets the user reorder the response set by keyboard-accessible buttons and confirm it", async () => {
    const user = userEvent.setup();
    render(<StepCleanup />);
    const list = screen.getByRole("list", { name: /Answer choices, lowest to highest/ });
    const labels = () => within(list).getAllByRole("listitem").map((li) => li.textContent?.replace(/\s*is coded as \d+/, "").replace(/^\d+/, ""));
    expect(labels()).toEqual(["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"]);
    await user.click(screen.getByRole("button", { name: "Move Disagree up" }));
    expect(labels()?.slice(0, 2)).toEqual(["Disagree", "Strongly disagree"]);
    const key = findResponseSets(useImportFlow.getState().preview!.files)[0].key;
    expect(useImportFlow.getState().decisions!.responseOrder[key][0]).toBe("Disagree");
    await user.click(screen.getByRole("checkbox", { name: /order and numbering are correct/ }));
    expect(useImportFlow.getState().decisions!.responseConfirmed[key]).toBe(true);
    // Moving again un-confirms, so a changed order is always re-checked.
    await user.click(screen.getByRole("button", { name: "Move Disagree down" }));
    expect(useImportFlow.getState().decisions!.responseConfirmed[key]).toBe(false);
  });
});
