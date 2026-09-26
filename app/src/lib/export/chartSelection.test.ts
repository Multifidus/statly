import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/contracts";
import { availableCharts, chartRows, pickReportChart } from "@/lib/export/chartSelection";

function result(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    schema_version: 1,
    analysis_id: "t_test.independent",
    statistics: [],
    effect_sizes: [],
    assumptions: [],
    descriptives: { continuous: [], frequencies: [] },
    plain_language_summary: "",
    apa_sentence: [],
    apa_table: null,
    additional_tables: [],
    warnings: [],
    chart_data: {},
    inputs: {
      request: { schema_version: 1, request_id: "req-1", analysis_id: "t_test.independent", dataset_id: "d", snapshot_id: "s", variables: {}, subset: [], options: {}, corrections: [], alpha: 0.05, tails: "two_sided", ci_level: 0.95 },
      dataset_id: "d", snapshot_id: "s", n_used: 10, n_excluded: 0, n_by_group: [],
    },
    engine_version: "test",
    timestamp: "2026-09-25T00:00:00Z",
    ...overrides,
  } as AnalysisResult;
}

describe("pickReportChart / availableCharts", () => {
  it("returns null when there are no assumptions with chart data", () => {
    expect(pickReportChart(result())).toBeNull();
    expect(availableCharts(result())).toEqual([]);
  });

  it("skips a ChartRef whose data_key has no rows, and finds one that does", () => {
    const r = result({
      assumptions: [
        { key: "normality", label: "Normality", test_used: null, statistic: null, p: null, verdict: "passed", explanation: "", applies_to: { kind: "overall", label: "Overall", group: null, n: 10 }, chart_refs: [{ chart_type: "qq_plot", title: "Q-Q plot (empty)", data_key: "qq_empty" }] },
        { key: "homogeneity", label: "Homogeneity", test_used: null, statistic: null, p: null, verdict: "passed", explanation: "", applies_to: { kind: "overall", label: "Overall", group: null, n: 10 }, chart_refs: [{ chart_type: "histogram", title: "Histogram", data_key: "hist_1" }] },
      ] as unknown as AnalysisResult["assumptions"],
      chart_data: { qq_empty: [], hist_1: [{ x: 1 }, { x: 2 }] },
    });
    const picked = pickReportChart(r);
    expect(picked?.data_key).toBe("hist_1");
    expect(chartRows(r, picked!)).toEqual([{ x: 1 }, { x: 2 }]);
  });

  it("picks the first assumption's chart in order, and de-dupes availableCharts by data_key", () => {
    const ref = { chart_type: "histogram", title: "Histogram", data_key: "hist_1" };
    const r = result({
      assumptions: [
        { key: "a", label: "A", test_used: null, statistic: null, p: null, verdict: "passed", explanation: "", applies_to: { kind: "overall", label: "Overall", group: null, n: 10 }, chart_refs: [ref] },
        { key: "b", label: "B", test_used: null, statistic: null, p: null, verdict: "passed", explanation: "", applies_to: { kind: "overall", label: "Overall", group: null, n: 10 }, chart_refs: [ref, { chart_type: "qq_plot", title: "Q-Q", data_key: "qq_1" }] },
      ] as unknown as AnalysisResult["assumptions"],
      chart_data: { hist_1: [{ x: 1 }], qq_1: [{ x: 2 }] },
    });
    expect(pickReportChart(r)?.data_key).toBe("hist_1");
    expect(availableCharts(r).map((c) => c.data_key)).toEqual(["hist_1", "qq_1"]);
  });
});
