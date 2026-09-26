// @vitest-environment node
/**
 * Real-engine chart builder test (SPEC §10.2, Phase 7): the engine computes chart data for the
 * practice one-group pre/post Likert data (stacked by Time) and the app compiles it to Vega-Lite,
 * which Vega then runs. Numbers are checked against the practice CSVs.
 * STATLY_CHART_SVG_DIR=<dir> writes each rendered chart as SVG for a visual check.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "vega-lite";
import { parse, View } from "vega";
import type { AnalysisResult, ChartSpec, ChartType, DatasetMeta } from "@/contracts";
import { compileChart } from "@/lib/chartbuilder/compile";
import { newChartSpec, withPreset } from "@/lib/chartbuilder/spec";
import type { ChartsDataResult } from "@/lib/chartbuilder/types";
import { chartsRpc, rpc, setTransport } from "@/lib/rpc";
import { resolveEngineCommand, StdioTransport } from "@/lib/transports/stdio";

const REPO = path.resolve(import.meta.dirname, "../../..");
const DIR = path.join(REPO, "fixtures", "practice", "one_group_prepost_likert");
const ITEMS = Array.from({ length: 10 }, (_, i) => `Q3_${i + 1}`);

let engine: StdioTransport;
let meta: DatasetMeta;

/** Numeric column of a 3-header-row Qualtrics CSV (the practice files have no quoted commas in data rows). */
function column(file: string, name: string): number[] {
  const lines = readFileSync(path.join(DIR, file), "utf8").trim().split(/\r?\n/);
  const idx = lines[0].split(",").indexOf(name);
  return lines.slice(3).map((l) => Number(l.split(",")[idx])).filter((x) => Number.isFinite(x));
}
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;

beforeAll(async () => {
  engine = StdioTransport.start(resolveEngineCommand(REPO), { timeoutMs: 120_000 });
  setTransport(engine);
  const files = ["pre.csv", "post.csv"].map((f) => path.join(DIR, f));
  const pv = await rpc.importPreview({ files: files.map((p) => ({ path: p, sheet_name: null })) as never, qualtrics_mode: "auto", stack_onto_dataset_id: null });
  const labels = ["Pre", "Post"];
  const res = await rpc.importDataset({
    preview_id: pv.preview_id,
    files: pv.files.map((f, i) => ({ file_id: f.file_id, sheet_name: f.sheet_name, encoding: f.encoding, delimiter: f.delimiter, qualtrics_header_rows: f.qualtrics.header_rows, time_label: labels[i], drop_columns: [] })),
    row_filters: [],
    variables: [],
    stack: { time_variable: "Time", column_matches: pv.stack_proposal!, levels: pv.files.map((f, i) => ({ file_id: f.file_id, label: labels[i] })) },
  } as never);
  meta = res.dataset_meta;
}, 120_000);

afterAll(async () => {
  await engine?.close();
});

function spec(type: ChartType, shelves: Partial<ChartSpec["shelves"]>, extra: Partial<ChartSpec> = {}): ChartSpec {
  return { ...newChartSpec(type, "2026-09-25T00:00:00Z"), id: `c_${type}`, shelves: { x: [], y: [], color: [], facet: [], ...shelves }, ...extra };
}
const f = (...names: string[]) => names.map((variable) => ({ variable, aggregate: "none" as const }));

async function render(s: ChartSpec, data: ChartsDataResult, name: string) {
  for (const theme of ["light", "dark"] as const) {
    const vg = compile(compileChart(s, data, { theme }) as never).spec;
    const view = new View(parse(vg), { renderer: "none" });
    await view.runAsync();
    const svg = await view.toSVG();
    expect(svg).toContain("<svg");
    const dir = process.env.STATLY_CHART_SVG_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${name}-${theme}.svg`), svg);
    }
    view.finalize();
  }
}

const ids = () => ({ dataset_id: meta.dataset_id, snapshot_id: meta.snapshot_id });

describe("charts.data on one_group_prepost_likert (real engine)", () => {
  it("bar chart: mean ± SE per time point matches the CSVs", async () => {
    const s = spec("bar", { x: f("Time"), y: [{ variable: "Q3_1", aggregate: "mean" }] }, { error_bars: "se" });
    const data = await chartsRpc.data({ ...ids(), spec: s });
    expect(data.rows.map((r) => r.x)).toEqual(["Pre", "Post"]);
    for (const [row, file] of [[data.rows[0], "pre.csv"], [data.rows[1], "post.csv"]] as const) {
      const x = column(file, "Q3_1");
      const m = mean(x);
      const se = Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / (x.length - 1)) / Math.sqrt(x.length);
      expect(row.value).toBeCloseTo(m, 10);
      expect(row.lower).toBeCloseTo(m - se, 10);
      expect(row.n).toBe(x.length);
    }
    await render(withPreset(s, "apa", 1), data, "bar");
  });

  it("Likert diverging bars: counts per response for every item, split by time", async () => {
    const s = spec("likert_diverging", { y: f(...ITEMS), facet: f("Time") as [never] });
    const data = await chartsRpc.data({ ...ids(), spec: s });
    expect(data.meta.levels!.response).toEqual(["1", "2", "3", "4", "5"]);
    const pre = column("pre.csv", "Q3_4");
    const rows = data.rows.filter((r) => r.item_variable === "Q3_4" && r.facet === "Pre");
    expect(rows.map((r) => r.count)).toEqual([1, 2, 3, 4, 5].map((v) => pre.filter((x) => x === v).length));
    await render(s, data, "likert");
  });

  it("histogram: Freedman-Diaconis bins cover every score", async () => {
    const s = spec("histogram", { x: f("Q3_2"), color: f("Time") as [never] });
    const data = await chartsRpc.data({ ...ids(), spec: s });
    const total = data.rows.reduce((a, r) => a + Number(r.count), 0);
    expect(total).toBe(column("pre.csv", "Q3_2").length + column("post.csv", "Q3_2").length);
    await render(s, data, "histogram");
  });

  it("renders the remaining dataset charts and the factor charts from logged results", async () => {
    const cases: [string, ChartSpec][] = [
      ["box", spec("box", { x: f("Time"), y: f("Q3_5") })],
      ["violin", spec("violin", { x: f("Time"), y: f("Q3_5") })],
      ["density", spec("density", { x: f("Q3_6"), color: f("Time") as [never] })],
      ["qq", spec("qq", { x: f("Q3_6") })],
      ["scatter", spec("scatter", { x: f("Q3_1"), y: f("Q3_2"), color: f("Time") as [never] })],
      ["heatmap", spec("correlation_heatmap", { x: f(...ITEMS) })],
      ["line", spec("line", { x: f("Time"), y: [{ variable: "Q3_1", aggregate: "mean" }, { variable: "Q3_2", aggregate: "mean" }] })],
      ["percent", spec("percent_bar", { y: f(...ITEMS.slice(0, 4)) })],
    ];
    for (const [name, s] of cases) {
      const data = await chartsRpc.data({ ...ids(), spec: s });
      expect(data.rows.length, name).toBeGreaterThan(0);
      await render(s, data, name);
    }
    for (const [aid, type] of [["validity.efa", "scree"], ["validity.cfa", "cfa_path"]] as const) {
      const request_id = `req-${type}`;
      const result: AnalysisResult = await rpc.analysisRun({
        schema_version: 1, request_id, analysis_id: aid, ...ids(), variables: { items: ITEMS }, subset: [], options: {}, corrections: [], alpha: 0.05, tails: "two_sided", ci_level: 0.95,
      } as never);
      await rpc.resultsPut({ request_id, result });
      const s = spec(type, {}, { source: { kind: "analysis", test_log_entry_id: request_id } });
      const data = await chartsRpc.data({ dataset_id: null, snapshot_id: null, spec: s });
      expect(data.meta.source).toBe("analysis");
      await render(s, data, type);
    }
  });
});
