import { beforeAll, describe, expect, it } from "vitest";
import { compile } from "vega-lite";
import { parse, View } from "vega";
import type { AnalysisResult, ChartSpec, ChartType } from "@/contracts";
import exampleResult from "../../../../contracts/examples/AnalysisResult.json";
import { MOCK_EXAMPLE_PROJECT_PATH } from "@/mocks/shapes";
import { useFreshMock } from "@/test/mockTransport";
import { CHART_TYPES } from "@/lib/chartbuilder/catalog";
import { apaNum, compileChart } from "@/lib/chartbuilder/compile";
import { numbersTable } from "@/lib/chartbuilder/numbers";
import { newChartSpec, withPreset } from "@/lib/chartbuilder/spec";
import type { ChartsDataResult } from "@/lib/chartbuilder/types";
import { chartsRpc, rpc } from "@/lib/rpc";
import { useDatasetStore } from "@/stores/dataset";
import { useProjectStore } from "@/stores/project";

const f = (...names: string[]) => names.map((variable) => ({ variable, aggregate: "none" as const }));
const m = (...names: string[]) => names.map((variable) => ({ variable, aggregate: "mean" as const }));

/** Shelves that make each chart type drawable on the mock example dataset. */
const SHELVES: Record<ChartType, ChartSpec["shelves"]> = {
  bar: { x: f("SC0_band"), y: m("math_attitude"), color: [], facet: [] },
  grouped_bar: { x: f("SC0_band"), y: m("math_attitude"), color: f("Time") as [never], facet: [] },
  line: { x: f("Time"), y: m("math_attitude"), color: f("SC0_band") as [never], facet: [] },
  interaction: { x: f("Time"), y: m("score_gain"), color: f("SC0_band") as [never], facet: [] },
  box: { x: f("SC0_band"), y: f("math_attitude"), color: [], facet: [] },
  violin: { x: f("Time"), y: f("math_attitude"), color: [], facet: [] },
  histogram: { x: f("math_attitude"), y: [], color: f("Time") as [never], facet: [] },
  density: { x: f("score_gain"), y: [], color: f("Time") as [never], facet: [] },
  qq: { x: f("math_attitude"), y: [], color: [], facet: f("Time") as [never] },
  scatter: { x: f("math_attitude"), y: f("score_gain"), color: f("Time") as [never], facet: [] },
  correlation_heatmap: { x: f("Q5_1", "Q5_2", "math_attitude", "score_gain"), y: [], color: [], facet: [] },
  likert_diverging: { x: [], y: f("Q5_1", "Q5_2"), color: [], facet: f("Time") as [never] },
  stacked_bar: { x: f("SC0_band"), y: [], color: f("Time") as [never], facet: [] },
  percent_bar: { x: [], y: f("Q5_1", "Q5_2"), color: [], facet: [] },
  scree: { x: [], y: [], color: [], facet: [] },
  cfa_path: { x: [], y: [], color: [], facet: [] },
};

function factorResult(id: string, analysis_id: string): AnalysisResult {
  const base = structuredClone(exampleResult) as unknown as AnalysisResult;
  const scree = [1, 2, 3, 4].map((number, i) => ({ number, eigenvalue: 2.6 / (i + 1), factor_eigenvalue: 2.1 / (i + 1), simulated_mean: 0.3, simulated_p95: 0.45, fitted_factor_eigenvalue: 2 / (i + 1) }));
  const path = [
    { kind: "node", id: "F1", label: "F1", node_type: "latent", residual: null },
    { kind: "node", id: "F2", label: "F2", node_type: "latent", residual: null },
    ...["a", "b", "c", "d"].map((v) => ({ kind: "node", id: v, label: `Item ${v}`, node_type: "observed", residual: 0.4 })),
    ...["a", "b"].map((v) => ({ kind: "edge", from: "F1", to: v, edge_type: "loading", weight: 0.77, estimate: 1, p: 0.001, marker: v === "a" })),
    ...["c", "d"].map((v) => ({ kind: "edge", from: "F2", to: v, edge_type: "loading", weight: 0.66, estimate: 1, p: 0.001, marker: v === "c" })),
    { kind: "edge", from: "F1", to: "F2", edge_type: "covariance", weight: 0.35, estimate: 0.2, p: 0.01, marker: false },
  ];
  return { ...base, analysis_id, inputs: { ...base.inputs, request: { ...base.inputs.request, request_id: id } }, chart_data: analysis_id === "validity.efa" ? { scree } : { path_diagram: path } } as AnalysisResult;
}

const specFor = (type: ChartType): ChartSpec => {
  const s = { ...newChartSpec(type, "2026-09-25T00:00:00Z"), id: `chart_${type}`, shelves: SHELVES[type] };
  if (type === "scree") s.source = { kind: "analysis", test_log_entry_id: "req-efa" };
  if (type === "cfa_path") s.source = { kind: "analysis", test_log_entry_id: "req-cfa" };
  return s;
};

const data: Partial<Record<ChartType, ChartsDataResult>> = {};

beforeAll(async () => {
  useFreshMock();
  await useProjectStore.getState().open(MOCK_EXAMPLE_PROJECT_PATH);
  await rpc.resultsPut({ request_id: "req-efa", result: factorResult("req-efa", "validity.efa") });
  await rpc.resultsPut({ request_id: "req-cfa", result: factorResult("req-cfa", "validity.cfa") });
  const meta = useDatasetStore.getState().meta!;
  for (const t of CHART_TYPES) {
    data[t.type] = await chartsRpc.data({ dataset_id: meta.dataset_id, snapshot_id: meta.snapshot_id, spec: specFor(t.type) });
  }
});

describe("compileChart", () => {
  it.each(CHART_TYPES.map((c) => c.type))("%s compiles to a valid Vega-Lite spec that Vega can run", async (type) => {
    const d = data[type]!;
    expect(d.rows.length).toBeGreaterThan(0);
    for (const theme of ["light", "dark"] as const) {
      for (const preset of ["statly", "apa"] as const) {
        let spec = specFor(type);
        if (preset === "apa") spec = withPreset(spec, "apa", 2);
        spec.customization = { ...spec.customization, data_labels: true, figure_note: preset === "apa" ? "Error bars show 95% CIs." : null };
        const vl = compileChart(spec, d, { theme });
        const vg = compile(vl as never).spec;
        const view = new View(parse(vg), { renderer: "none" });
        await view.runAsync();
        view.finalize();
      }
    }
    expect(numbersTable(specFor(type), d).columns.length).toBeGreaterThan(0);
  });

  it("applies the APA preset: figure number, italic title, no gridlines, sans-serif, note", () => {
    const spec = withPreset({ ...specFor("bar"), error_bars: "se", customization: { title: "Attitude by band", figure_note: "Bars show ±1 SE." } }, "apa", 3);
    const vl = compileChart(spec, data.bar!, { theme: "light" }) as Record<string, any>;
    expect(vl.title).toMatchObject({ text: "Figure 3", subtitle: "Attitude by band", subtitleFontStyle: "italic", fontWeight: "bold" });
    expect(vl.config.axis.grid).toBe(false);
    expect(vl.config.font).toMatch(/Arial/);
    expect(vl.vconcat[1].data.values[0].t).toBe("Note. Bars show ±1 SE.");
  });

  it("uses the colorblind-safe palette by default, greyscale on request, and custom colors", () => {
    const base = specFor("grouped_bar");
    const scaleOf = (s: ChartSpec) => ((compileChart(s, data.grouped_bar!, { theme: "light" }) as any).layer[0].encoding.color.scale.range as string[]);
    expect(scaleOf(base).slice(0, 2)).toEqual(["#0072B2", "#E69F00"]);
    expect(scaleOf({ ...base, customization: { ...base.customization, greyscale: true } })[0]).toBe("#000000");
    expect(scaleOf({ ...base, customization: { palette: "custom", custom_colors: ["#112233", "#445566"] } })).toEqual(["#112233", "#445566"]);
  });

  it("formats APA numbers without a leading zero", () => {
    expect(apaNum(0.456)).toBe(".46");
    expect(apaNum(-0.2)).toBe("-.20");
    expect(apaNum(1)).toBe("1.00");
  });

  // Snapshots: pinned to fixed data so they only change when the compiler does.
  it("snapshot: bar chart with 95% CI error bars", () => {
    const d: ChartsDataResult = {
      rows: [
        { x: "Control", value: 3.1, lower: 2.8, upper: 3.4, n: 20, mean: 3.1, sd: 0.6, se: 0.13, ci_low: 2.8, ci_high: 3.4 },
        { x: "Treatment", value: 3.7, lower: 3.4, upper: 4.0, n: 22, mean: 3.7, sd: 0.7, se: 0.15, ci_low: 3.4, ci_high: 4.0 },
      ],
      meta: { chart_type: "bar", source: "dataset", levels: { x: ["Control", "Treatment"] }, labels: { x: "Condition", value: "Mean attitude" }, aggregate: "mean", error_bars: "ci95" },
    };
    const spec: ChartSpec = { ...newChartSpec("bar", "2026-09-25T00:00:00Z"), id: "snap", shelves: { x: f("cond"), y: m("att"), color: [], facet: [] } };
    expect(compileChart(spec, d, { theme: "light" })).toMatchSnapshot();
  });

  it("snapshot: APA Likert diverging bars", () => {
    const rows = ["Item 1", "Item 2"].flatMap((item, k) => {
      const pct = k ? [10, 20, 30, 25, 15] : [5, 15, 20, 40, 20];
      let pos = -(pct[0] + pct[1] + pct[2] / 2);
      return pct.map((p, i) => {
        const r = { item, response: String(i + 1), order: i, count: p, n: 100, percent: p, start: pos, end: pos + p };
        pos += p;
        return r;
      });
    });
    const d: ChartsDataResult = { rows, meta: { chart_type: "likert_diverging", source: "dataset", levels: { item: ["Item 1", "Item 2"], response: ["1", "2", "3", "4", "5"] }, labels: { item: "Item", response: "Response" }, neutral: "3" } };
    const spec = withPreset({ ...newChartSpec("likert_diverging", "2026-09-25T00:00:00Z"), id: "snap2", shelves: { x: [], y: f("i1", "i2"), color: [], facet: [] } }, "apa", 1);
    expect(compileChart(spec, d, { theme: "light" })).toMatchSnapshot();
  });
});
