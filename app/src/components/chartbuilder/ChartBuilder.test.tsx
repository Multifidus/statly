import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockEngine } from "@/mocks/engine";
import { MOCK_EXAMPLE_PROJECT_PATH } from "@/mocks/shapes";
import { useFreshMock } from "@/test/mockTransport";
import { ChartBuilder } from "@/components/chartbuilder/ChartBuilder";
import { useChartBuilder } from "@/stores/chartBuilder";
import { useProjectStore } from "@/stores/project";

// The Preview's Save figure… wiring (getVegaView/getActiveChartView -> SaveFigureButton) is what's
// under test here; the button's own PNG/SVG/PDF menu behavior is covered by SaveFigureButton.test.tsx.
let captured: { view: () => unknown; title: string; defaultName: string } | null = null;
vi.mock("@/components/export/SaveFigureButton", () => ({
  SaveFigureButton: (props: { view: () => unknown; title: string; defaultName: string }) => {
    captured = props;
    return <button data-testid="mock-save-figure">Save figure…</button>;
  },
}));

let engine: MockEngine;
const cb = () => useChartBuilder.getState();

beforeEach(async () => {
  captured = null;
  engine = useFreshMock();
  cb().close();
  await useProjectStore.getState().open(MOCK_EXAMPLE_PROJECT_PATH);
});

describe("ChartBuilder Preview: Save figure…", () => {
  it("mounts once the chart is drawn, wired to the live Vega view and a sanitized default filename", async () => {
    cb().startNew("bar");
    cb().addField("x", "SC0_band");
    cb().addField("y", "math_attitude");
    await cb().refresh();
    expect(engine.calls.some((c) => c.method === "charts.data")).toBe(true);

    render(<ChartBuilder spec={cb().draft!} />);
    const chart = await screen.findByTestId("builder-chart");
    await waitFor(() => expect(chart.querySelector("svg")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("mock-save-figure")).toBeInTheDocument());

    expect(captured).not.toBeNull();
    expect(captured!.title).toMatch(/^Bar chart with error bars:/);
    expect(captured!.defaultName).not.toMatch(/[\\/:*?"<>|]/);

    const view = captured!.view() as { toImageURL?: unknown; toSVG?: unknown } | null;
    expect(view).not.toBeNull();
    expect(typeof view?.toImageURL).toBe("function");
    expect(typeof view?.toSVG).toBe("function");
  });

  it("stays hidden while the chart can't be drawn yet (nothing on the shelves)", () => {
    cb().startNew("bar");
    render(<ChartBuilder spec={cb().draft!} />);
    expect(screen.getByTestId("chart-missing")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-save-figure")).not.toBeInTheDocument();
  });
});
