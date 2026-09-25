import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepStacking } from "@/components/import/StepStacking";
import { blockingReason } from "@/lib/importLogic";
import { useImportFlow } from "@/stores/importFlow";
import { THREE, useFreshMock } from "@/test/mockTransport";

const blocked = () => {
  const s = useImportFlow.getState();
  return blockingReason("stack", s.preview, s.decisions, s.files.length);
};

describe("StepStacking (review)", () => {
  beforeEach(async () => {
    useFreshMock();
    useImportFlow.getState().addFiles(THREE);
    await useImportFlow.getState().runPreview();
  });

  it("shows editable time labels in order and lets the user rename and reorder them", async () => {
    const user = userEvent.setup();
    render(<StepStacking />);
    const pre = screen.getByRole("textbox", { name: /Time label for pre.csv/ });
    expect(pre).toHaveValue("Pre");
    expect(screen.getByRole("textbox", { name: /Time label for followup.csv/ })).toHaveValue("Follow-up");
    await user.clear(pre);
    expect(blocked()).toMatch(/time label/);
    await user.type(pre, "Baseline");
    const d = useImportFlow.getState().decisions!;
    expect(Object.values(d.timeLabels)).toContain("Baseline");

    await user.click(screen.getByRole("button", { name: "Move followup.csv earlier" }));
    const order = useImportFlow.getState().decisions!.levelOrder;
    const names = order.map((id) => useImportFlow.getState().preview!.files.find((f) => f.file_id === id)!.name);
    expect(names).toEqual(["pre.csv", "followup.csv", "post.csv"]);
  });

  it("groups columns into matched, possibly renamed, and only-in-some-files", () => {
    render(<StepStacking />);
    expect(screen.getByText(/Matched in every file/)).toBeInTheDocument();
    const renamed = screen.getByTestId("renamed-SC0");
    expect(within(renamed).getByText("SC1")).toBeInTheDocument();
    expect(within(renamed).getByText(/100% similar/)).toBeInTheDocument();
    const unmatched = screen.getByRole("region", { name: /Only in some files/ });
    expect(within(unmatched).getByText("Q11")).toBeInTheDocument();
  });

  it("requires a decision on each possibly renamed question", async () => {
    const user = userEvent.setup();
    render(<StepStacking />);
    expect(blocked()).toMatch(/possibly renamed/);
    await user.click(screen.getByRole("radio", { name: /Different questions: keep separate/ }));
    expect(useImportFlow.getState().decisions!.matchDecisions.SC0).toBe("separate");
    expect(blocked()).toBeNull();
    await user.click(screen.getByRole("radio", { name: /Same question: combine them/ }));
    expect(useImportFlow.getState().decisions!.matchDecisions.SC0).toBe("accept");
  });

  it("has a 'Why does this matter?' expander", () => {
    render(<StepStacking />);
    expect(screen.getByRole("button", { name: /Why does this matter/ })).toBeInTheDocument();
  });
});
