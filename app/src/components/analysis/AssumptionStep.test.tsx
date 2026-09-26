import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisResult } from "@/contracts";
import example from "../../../../contracts/examples/AnalysisResult.json";
import { AssumptionStep } from "@/components/analysis/AssumptionStep";

describe("AssumptionStep", () => {
  it("mounts a Save figure… button on the assumption's chart, wired to its result and chart_refs entry", () => {
    const result = example as unknown as AnalysisResult;
    render(<AssumptionStep result={result} index={0} onBack={vi.fn()} onNext={vi.fn()} />);
    const chart = screen.getByTestId("chart-qq");
    expect(chart).toBeInTheDocument();
    expect(screen.getByTestId("save-figure")).toBeInTheDocument();
  });
});
