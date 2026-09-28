/**
 * QA #49: exported figures (report PDF/DOCX, "Save figure…", assumption plots) must use a print
 * palette regardless of the app's on-screen theme — dark-theme muted grey axis text/titles are
 * nearly invisible on white paper. withPrintPalette is the one override every export path applies
 * (see lib/export/figure.ts's withVlSpec); this checks it actually forces the print colors, for
 * both a result/assumption chart (chartSpec) and a Chart Builder chart (compileChart).
 */
import { describe, expect, it } from "vitest";
import { chartSpec, withPrintPalette, type VlSpec } from "@/lib/chartSpecs";
import { compileChart } from "@/lib/chartbuilder/compile";
import { newChartSpec } from "@/lib/chartbuilder/spec";
import type { ChartsDataResult } from "@/lib/chartbuilder/types";

function configOf(spec: VlSpec) {
  return spec.config as { background: string; axis: { labelColor: string; titleColor: string; domainColor: string; tickColor: string; gridColor: string }; title: { color: string }; legend: { labelColor: string; titleColor: string } };
}

describe("withPrintPalette", () => {
  it("forces print colors on a result/assumption chart (qq), compiled dark", () => {
    const rows = [
      { theoretical: -1, sample: 10 },
      { theoretical: 0, sample: 12 },
      { theoretical: 1, sample: 14 },
    ];
    const spec = chartSpec("qq", rows, "dark", "Normal Q-Q plot");
    expect(spec).not.toBeNull();
    const printed = withPrintPalette(spec!);
    const c = configOf(printed);
    expect(c.background).toBe("#ffffff");
    expect(c.axis.labelColor).toBe("#111111");
    expect(c.axis.titleColor).toBe("#111111");
    expect(c.axis.domainColor).toBe("#666666");
    expect(c.axis.gridColor).toBe("#d9d9d9");
    expect(c.title.color).toBe("#111111");
  });

  it("forces print colors on a Chart Builder chart (bar), compiled dark", () => {
    const spec = newChartSpec("bar", "2026-09-25T00:00:00Z");
    spec.shelves = { x: [{ variable: "group", aggregate: "none" }], y: [{ variable: "score", aggregate: "mean" }], color: [], facet: [] };
    const data: ChartsDataResult = {
      rows: [
        { x: "A", value: 1, n: 5 },
        { x: "B", value: 2, n: 5 },
      ],
      meta: { chart_type: "bar", source: "dataset", labels: { x: "Group", value: "Score" } },
    };
    const vl = compileChart(spec, data, { theme: "dark" });
    const printed = withPrintPalette(vl);
    const c = configOf(printed);
    expect(c.background).toBe("#ffffff");
    expect(c.axis.labelColor).toBe("#111111");
    expect(c.axis.titleColor).toBe("#111111");
    expect(c.axis.domainColor).toBe("#666666");
    expect(c.axis.gridColor).toBe("#d9d9d9");
    expect(c.title.color).toBe("#111111");
    expect(c.legend.labelColor).toBe("#111111");
  });
});
