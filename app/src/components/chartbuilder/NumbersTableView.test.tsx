import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NumbersTableView } from "@/components/chartbuilder/NumbersTableView";
import { newChartSpec } from "@/lib/chartbuilder/spec";
import type { ChartsDataResult } from "@/lib/chartbuilder/types";

// Owner bug (QA #33): "1 rows used" instead of "1 row used". NumbersTableView must go through
// lib/plural.ts for both the used and left-out counts.
function dataWith(n_used: number, n_excluded: number): ChartsDataResult {
  return { rows: [], meta: { chart_type: "histogram", source: "dataset", n_used, n_excluded } };
}

describe("NumbersTableView caption pluralization", () => {
  it("says '1 row used' for a single row, with no left-out clause when nothing was excluded", () => {
    const spec = newChartSpec("histogram", "2026-09-25T00:00:00Z");
    render(<NumbersTableView spec={spec} data={dataWith(1, 0)} />);
    expect(screen.getByText(/1 row used/)).toBeInTheDocument();
    expect(screen.queryByText(/left out/)).not.toBeInTheDocument();
  });

  it("says '1 row left out' (not '1 rows left out') when exactly one row is excluded", () => {
    const spec = newChartSpec("histogram", "2026-09-25T00:00:00Z");
    render(<NumbersTableView spec={spec} data={dataWith(5, 1)} />);
    expect(screen.getByText(/5 rows used, 1 row left out/)).toBeInTheDocument();
  });

  it("uses the plural for counts other than one", () => {
    const spec = newChartSpec("histogram", "2026-09-25T00:00:00Z");
    render(<NumbersTableView spec={spec} data={dataWith(12, 3)} />);
    expect(screen.getByText(/12 rows used, 3 rows left out/)).toBeInTheDocument();
  });
});
