import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { RoleAssignment } from "@/components/analysis/RoleAssignment";
import { useAnalysisFlow } from "@/stores/analysisFlow";
import { importMockOneGroup, useFreshMock } from "@/test/mockTransport";

beforeEach(() => {
  useFreshMock();
});

async function setUpOneSample() {
  const meta = await importMockOneGroup();
  await useAnalysisFlow.getState().loadCatalog();
  useAnalysisFlow.setState({ outcome: "Q3_1" });
  useAnalysisFlow.getState().selectAnalysis("t_test.one_sample");
  useAnalysisFlow.getState().setRole("outcome", ["Q3_1"]);
  return meta;
}

describe("RoleAssignment", () => {
  it("shows a required test-value field pre-filled with the scale midpoint, and names its origin", async () => {
    const meta = await setUpOneSample();
    render(<RoleAssignment meta={meta} />);
    const field = screen.getByTestId("flow-test-value") as HTMLInputElement;
    expect(field.value).toBe("3");
    expect(screen.getByText(/Suggested: 3, the middle of a 1–5 scale/)).toBeInTheDocument();
    expect(screen.getByTestId("flow-run")).not.toBeDisabled();
  });

  it("disables Run when the test value is cleared, and re-enables it once one is entered", async () => {
    const meta = await setUpOneSample();
    render(<RoleAssignment meta={meta} />);
    const field = screen.getByTestId("flow-test-value");
    fireEvent.change(field, { target: { value: "" } });
    expect(screen.getByTestId("flow-run")).toBeDisabled();
    fireEvent.change(field, { target: { value: "4" } });
    expect(screen.getByTestId("flow-run")).not.toBeDisabled();
  });

  it("does not show the test-value field for analyses that don't need one", async () => {
    const meta = await importMockOneGroup();
    await useAnalysisFlow.getState().loadCatalog();
    useAnalysisFlow.getState().selectAnalysis("t_test.independent");
    render(<RoleAssignment meta={meta} />);
    expect(screen.queryByTestId("flow-test-value")).not.toBeInTheDocument();
  });
});
