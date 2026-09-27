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

  it("shows the engine's 'Because' sentence explaining why the verdict was reached", () => {
    const result = example as unknown as AnalysisResult;
    render(<AssumptionStep result={result} index={0} onBack={vi.fn()} onNext={vi.fn()} />);
    const verdictBlock = screen.getByTestId("assumption-verdict");
    expect(verdictBlock.textContent).toContain("Because the p value");
  });

  it("shows proper 'What it is' / 'Why it matters' copy and a natural rule-based 'What Statly checked' sentence for expected_cell_counts", () => {
    const base = example as unknown as AnalysisResult;
    const result: AnalysisResult = {
      ...base,
      assumptions: [
        {
          ...base.assumptions[0],
          assumption: "expected_cell_counts",
          label: "Expected cell counts",
          test_used: { key: "expected_cell_counts_rule", label: "Expected cell counts (rule of thumb)" },
          statistic: { symbol: "E_min", value: 3.3, df: [] },
          p: null,
          verdict: "failed",
          explanation: "The smallest expected count (3.30) is below 5.",
          applies_to: { kind: "overall", label: "All groups", group: null, n: 300 },
          chart_refs: [],
        },
      ],
    };
    render(<AssumptionStep result={result} index={0} onBack={vi.fn()} onNext={vi.fn()} />);

    expect(screen.getByText(/Chi-square compares the counts you observed/)).toBeInTheDocument();
    expect(screen.getByText(/With tiny expected counts, the chi-square p-value can be off/)).toBeInTheDocument();
    expect(
      screen.getByText("Statly worked out the expected count for every cell of the table; the smallest was 3.30."),
    ).toBeInTheDocument();
  });
});
