import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockEngine } from "@/mocks/engine";
import { MOCK_EXAMPLE_PROJECT_PATH } from "@/mocks/shapes";
import { useFreshMock } from "@/test/mockTransport";
import { ChartBuilder } from "@/components/chartbuilder/ChartBuilder";
import { useChartBuilder } from "@/stores/chartBuilder";
import { useProjectStore } from "@/stores/project";

// The Preview's Save figure… wiring (spec/data/builderTheme -> SaveFigureButton) is what's under
// test here; the button's own PNG/SVG/PDF menu behavior is covered by SaveFigureButton.test.tsx.
let captured: { spec: unknown; data: unknown; builderTheme: unknown; title: string; defaultName: string } | null = null;
vi.mock("@/components/export/SaveFigureButton", () => ({
  SaveFigureButton: (props: { spec: unknown; data: unknown; builderTheme: unknown; title: string; defaultName: string }) => {
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

    // The compiled spec + its data go to SaveFigureButton directly now, not a live Vega view — so
    // "Save figure…" can re-render off-screen with the print palette (see saveFigure.ts).
    expect(captured!.spec).toBe(cb().draft);
    expect(captured!.data).not.toBeNull();
    expect(captured!.builderTheme).toBe("light");
  });

  it("stays hidden while the chart can't be drawn yet (nothing on the shelves)", () => {
    cb().startNew("bar");
    render(<ChartBuilder spec={cb().draft!} />);
    expect(screen.getByTestId("chart-missing")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-save-figure")).not.toBeInTheDocument();
  });
});
