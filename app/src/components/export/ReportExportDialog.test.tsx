import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { newChartSpec } from "@/lib/chartbuilder/spec";
import { MOCK_EXAMPLE_PROJECT_PATH } from "@/mocks/shapes";
import { useFreshMock } from "@/test/mockTransport";
import { useExportFlow } from "@/stores/exportFlow";
import { useProjectStore } from "@/stores/project";
import { ReportExportDialog } from "./ReportExportDialog";

/** Two saved builder charts, one titled and one untitled (falls back to "Chart" like
 * components/chartbuilder/ChartsList.tsx's chartName()). */
function addProjectCharts() {
  const titled = { ...newChartSpec("box"), id: "chart_titled", customization: { title: "Anxiety by Group" } };
  const untitled = { ...newChartSpec("bar"), id: "chart_untitled" };
  useProjectStore.getState().updateProject((p) => ({ ...p, chart_specs: [titled, untitled] }));
  return { titled, untitled };
}

beforeEach(async () => {
  useFreshMock();
  await useProjectStore.getState().open(MOCK_EXAMPLE_PROJECT_PATH);
});

describe("ReportExportDialog: Project charts", () => {
  it("is hidden when the project has no saved charts", () => {
    // MOCK_EXAMPLE_PROJECT_PATH ships one chart_specs entry; start a blank project instead.
    useProjectStore.getState().newProject("Blank");
    useExportFlow.getState().show();
    render(<ReportExportDialog />);
    expect(screen.queryByText("Project charts")).not.toBeInTheDocument();
  });

  it("lists every saved chart by title, all ticked by default, once charts exist", () => {
    addProjectCharts();
    useExportFlow.getState().show();
    render(<ReportExportDialog />);

    expect(screen.getByText("Project charts")).toBeInTheDocument();
    const titled = screen.getByTestId("report-chart-chart_titled") as HTMLInputElement;
    const untitled = screen.getByTestId("report-chart-chart_untitled") as HTMLInputElement;
    expect(screen.getByText("Anxiety by Group")).toBeInTheDocument();
    expect(screen.getByText("Chart")).toBeInTheDocument(); // untitled fallback
    expect(titled.checked).toBe(true);
    expect(untitled.checked).toBe(true);
    expect(useExportFlow.getState().projectChartIds.sort()).toEqual(["chart_titled", "chart_untitled"]);
  });

  it("renames the per-test charts checkbox so it isn't confused with project charts", () => {
    addProjectCharts();
    useExportFlow.getState().show();
    render(<ReportExportDialog />);
    expect(screen.getByText("Charts from each test")).toBeInTheDocument();
    expect(screen.queryByText("Charts")).not.toBeInTheDocument(); // exact match: old label text is gone
  });

  it("Clear then Select all toggle every project chart, and unticking one is reflected in state", async () => {
    const user = userEvent.setup();
    addProjectCharts();
    useExportFlow.getState().show();
    render(<ReportExportDialog />);

    await user.click(screen.getByTestId("report-chart-chart_untitled"));
    expect(useExportFlow.getState().projectChartIds).toEqual(["chart_titled"]);

    await user.click(screen.getByTestId("report-clear-charts"));
    expect(useExportFlow.getState().projectChartIds).toEqual([]);
    expect((screen.getByTestId("report-chart-chart_titled") as HTMLInputElement).checked).toBe(false);

    await user.click(screen.getByTestId("report-select-all-charts"));
    expect(useExportFlow.getState().projectChartIds.sort()).toEqual(["chart_titled", "chart_untitled"]);
  });

  it("lets Export run with project charts selected and no logged tests chosen (figure-only report)", () => {
    addProjectCharts();
    useExportFlow.getState().show();
    useExportFlow.getState().clearSelection();
    render(<ReportExportDialog />);
    expect(screen.getByTestId("report-export-run")).toBeEnabled();
  });
});
