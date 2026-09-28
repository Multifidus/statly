import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult, ChartRef, ChartSpec } from "@/contracts";
import type { ChartsDataResult } from "@/lib/chartbuilder/types";
import { SaveFigureButton } from "@/components/export/SaveFigureButton";
import { useNotify } from "@/stores/notify";

const saveFigurePng = vi.fn(async () => ({ path: "/mock/exports/Fig.png", dpi: 300 }));
const saveFigureSvg = vi.fn(async () => ({ path: "/mock/exports/Fig.svg" }));
const saveFigurePdf = vi.fn(async () => ({ path: "/mock/exports/Fig.pdf" }));
const saveBuilderFigurePng = vi.fn(async () => ({ path: "/mock/exports/Builder.png", dpi: 300 }));
const saveBuilderFigureSvg = vi.fn(async () => ({ path: "/mock/exports/Builder.svg" }));
const saveBuilderFigurePdf = vi.fn(async () => ({ path: "/mock/exports/Builder.pdf" }));

vi.mock("@/lib/export/saveFigure", async () => {
  const actual = await vi.importActual<typeof import("@/lib/export/saveFigure")>("@/lib/export/saveFigure");
  return {
    ...actual,
    saveFigurePng: (...args: unknown[]) => saveFigurePng(...(args as [])),
    saveFigureSvg: (...args: unknown[]) => saveFigureSvg(...(args as [])),
    saveFigurePdf: (...args: unknown[]) => saveFigurePdf(...(args as [])),
    saveBuilderFigurePng: (...args: unknown[]) => saveBuilderFigurePng(...(args as [])),
    saveBuilderFigureSvg: (...args: unknown[]) => saveBuilderFigureSvg(...(args as [])),
    saveBuilderFigurePdf: (...args: unknown[]) => saveBuilderFigurePdf(...(args as [])),
  };
});

const chart: ChartRef = { chart_type: "histogram", title: "Histogram", data_key: "hist_1" };
const result = { chart_data: { hist_1: [{ x: 1 }] } } as unknown as AnalysisResult;

beforeEach(() => {
  vi.clearAllMocks();
  useNotify.getState().dismiss();
});

describe("SaveFigureButton", () => {
  it("result mode: every menu item calls the chart_data-based save function", async () => {
    const user = userEvent.setup();
    render(<SaveFigureButton result={result} chart={chart} defaultName="Histogram" />);
    await user.click(screen.getByTestId("save-figure"));
    await user.click(await screen.findByText(/PNG \(300 DPI\)/));
    expect(saveFigurePng).toHaveBeenCalledWith(chart, result.chart_data.hist_1, "light", 2, "Histogram");

    await user.click(screen.getByTestId("save-figure"));
    await user.click(await screen.findByText("SVG (vector)"));
    expect(saveFigureSvg).toHaveBeenCalledWith(chart, result.chart_data.hist_1, "light", "Histogram");

    await user.click(screen.getByTestId("save-figure"));
    await user.click(await screen.findByText("PDF"));
    expect(saveFigurePdf).toHaveBeenCalledWith(result, chart, "light", "Histogram");
  });

  it("builder mode (Chart Builder): every menu item re-renders the compiled spec, not the live view", async () => {
    const spec = { chart_type: "bar" } as unknown as ChartSpec;
    const data = { rows: [], meta: {} } as unknown as ChartsDataResult;
    const user = userEvent.setup();
    render(<SaveFigureButton spec={spec} data={data} builderTheme="dark" title="Bar chart" defaultName="Bar chart" />);

    await user.click(screen.getByTestId("save-figure"));
    await user.click(await screen.findByText(/PNG \(600 DPI\)/));
    expect(saveBuilderFigurePng).toHaveBeenCalledWith(spec, data, "dark", 4, "Bar chart");

    await user.click(screen.getByTestId("save-figure"));
    await user.click(await screen.findByText("SVG (vector)"));
    expect(saveBuilderFigureSvg).toHaveBeenCalledWith(spec, data, "dark", "Bar chart");

    await user.click(screen.getByTestId("save-figure"));
    await user.click(await screen.findByText("PDF"));
    expect(saveBuilderFigurePdf).toHaveBeenCalledWith(spec, data, "dark", "Bar chart", "Bar chart");
  });
});
