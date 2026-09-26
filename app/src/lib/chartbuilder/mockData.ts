/**
 * Mock-engine version of `charts.data` (VITE_STATLY_MOCK=1 and jsdom tests). Same row shapes as
 * engine/statly_engine/charts; the numbers use the same formulas but aren't reference-tested here
 * (the Python engine is, in engine/tests/charts).
 */
import type { AnalysisResult, CellValue, DatasetMeta, VariableSchema } from "@/contracts";
import type { ChartRow, ChartsDataParams, ChartsDataResult } from "@/lib/chartbuilder/types";

type Cell = (r: number, col: string) => CellValue;
export class MockChartError extends Error {
  constructor(
    message: string,
    readonly code = -32003,
  ) {
    super(message);
  }
}
const need = (ok: unknown, msg: string) => {
  if (!ok) throw new MockChartError(msg);
};

const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) => (x.length > 1 ? Math.sqrt(x.reduce((a, b) => a + (b - mean(x)) ** 2, 0) / (x.length - 1)) : NaN);
const quantile = (sorted: number[], p: number) => {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] ?? sorted[lo]) - sorted[lo]);
};
const fin = (v: number) => (Number.isFinite(v) ? v : null);
// Two-sided 97.5% t quantiles (df 1..30), normal beyond.
const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
const t975 = (df: number) => (df <= 30 ? T975[df - 1] : 1.96 + 2.4 / df);
const normPpf = (p: number): number => {
  // Acklam's rational approximation.
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - 0.02425) return -normPpf(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};

interface Ctx {
  meta: DatasetMeta;
  cell: Cell;
  rows: number[];
}

function variable(ctx: Ctx, name: string): VariableSchema {
  const v = ctx.meta.variables.find((x) => x.name === name);
  need(v, `These variables are not in the dataset: ${name}.`);
  return v!;
}
const labelOf = (v: VariableSchema) => v.label || v.name;
function valueLabel(v: VariableSchema, value: CellValue): string {
  const vl = v.value_labels.find((l) => String(l.value) === String(value));
  return vl ? vl.label : String(value);
}
function numeric(ctx: Ctx, name: string): (number | null)[] {
  const v = variable(ctx, name);
  need(["integer", "float", "boolean"].includes(v.dtype), `'${labelOf(v)}' holds text, not numbers, so it can't be used as a score here.`);
  return ctx.rows.map((r) => {
    const x = ctx.cell(r, name);
    return typeof x === "number" ? x : typeof x === "boolean" ? Number(x) : null;
  });
}
function category(ctx: Ctx, name: string): { values: (string | null)[]; levels: string[]; label: string } {
  const v = variable(ctx, name);
  const values = ctx.rows.map((r) => {
    const x = ctx.cell(r, name);
    return x === null || x === undefined || x === "" ? null : valueLabel(v, x);
  });
  const present = new Set(values.filter((x): x is string => x !== null));
  const ordered = v.value_labels.map((l) => l.label).filter((l) => present.has(l));
  const rest = [...present].filter((x) => !ordered.includes(x)).sort((a, b) => (Number.isFinite(+a) && Number.isFinite(+b) ? +a - +b : a.localeCompare(b)));
  return { values, levels: [...ordered, ...rest], label: labelOf(v) };
}

type Spec = ChartsDataParams["spec"];
const names = (spec: Spec, shelf: "x" | "y" | "color" | "facet") => spec.shelves[shelf].map((f) => f.variable);

function groupKeys(ctx: Ctx, spec: Spec, extra: Record<string, string> = {}, skip: string[] = []) {
  const want: Record<string, string> = { ...extra };
  const [c] = names(spec, "color");
  const [f1, f2] = names(spec, "facet");
  if (c && !skip.includes("color")) want.color = c;
  if (f1) want.facet = f1;
  if (f2) want.facet2 = f2;
  const cols: Record<string, (string | null)[]> = {};
  const levels: Record<string, string[]> = {};
  const labels: Record<string, string> = {};
  for (const [k, n] of Object.entries(want)) {
    const cat = category(ctx, n);
    cols[k] = cat.values;
    levels[k] = cat.levels;
    labels[k] = cat.label;
  }
  const fields = Object.keys(cols);
  const combos: Record<string, string>[] = [{}];
  for (const f of fields) {
    const next: Record<string, string>[] = [];
    for (const c0 of combos) for (const l of levels[f]) next.push({ ...c0, [f]: l });
    combos.splice(0, combos.length, ...next);
  }
  const groups = combos
    .map((key) => ({ key, idx: ctx.rows.map((_, i) => i).filter((i) => fields.every((f) => cols[f][i] === key[f])) }))
    .filter((g) => g.idx.length > 0);
  return { groups, levels, labels };
}

function summarize(x: number[]) {
  const n = x.length;
  const m = mean(x);
  const s = sd(x);
  const se = s / Math.sqrt(n);
  const half = n > 1 ? t975(n - 1) * se : NaN;
  const sorted = [...x].sort((a, b) => a - b);
  return { n, mean: m, median: quantile(sorted, 0.5), sum: x.reduce((a, b) => a + b, 0), sd: fin(s), se: fin(se), ci_low: fin(m - half), ci_high: fin(m + half) };
}

function means(ctx: Ctx, spec: Spec): ChartsDataResult {
  const ys = names(spec, "y");
  const xs = names(spec, "x");
  need(ys.length, "Put a number variable (the score to average) on the Y shelf.");
  if (spec.chart_type === "grouped_bar" || spec.chart_type === "interaction") need(xs.length && names(spec, "color").length, "This chart compares two groupings: put one on X and the other on Color/Group.");
  const aggRaw = spec.shelves.y[0].aggregate;
  const agg = aggRaw === "none" || aggRaw === "percent" ? "mean" : aggRaw;
  const multi = ys.length > 1;
  const varField = multi ? (!xs.length ? "x" : !names(spec, "color").length ? "color" : null) : null;
  need(!multi || varField, "With several variables on Y, leave X or Color/Group free so they can be told apart.");
  const { groups, levels, labels } = groupKeys(ctx, spec, xs.length ? { x: xs[0] } : {}, varField === "color" ? ["color"] : []);
  const rows: ChartRow[] = [];
  const yLabels = ys.map((y) => labelOf(variable(ctx, y)));
  if (varField) {
    levels[varField] = yLabels;
    labels[varField] = "Variable";
  }
  let used = 0;
  ys.forEach((y, yi) => {
    const vals = numeric(ctx, y);
    for (const g of groups) {
      const x = g.idx.map((i) => vals[i]).filter((v): v is number => v !== null);
      if (!x.length) continue;
      used += x.length;
      const s = summarize(x);
      const value = agg === "mean" ? s.mean : agg === "median" ? s.median : agg === "sum" ? s.sum : s.n;
      const spread = spec.error_bars === "se" ? s.se : spec.error_bars === "sd" ? s.sd : null;
      const [lower, upper] =
        agg !== "mean" || spec.error_bars === "none" ? [null, null] : spec.error_bars === "ci95" ? [s.ci_low, s.ci_high] : spread === null ? [null, null] : [s.mean - spread, s.mean + spread];
      rows.push({ ...g.key, ...(varField ? { [varField]: yLabels[yi] } : {}), variable: yLabels[yi], value, lower, upper, ...s });
    }
  });
  const word = { mean: "Mean", median: "Median", sum: "Total", count: "Count" }[agg as "mean"];
  labels.y = multi ? "Score" : yLabels[0];
  labels.value = agg === "count" ? "Number of responses" : `${word} ${labels.y}`;
  return { rows, meta: { chart_type: spec.chart_type, source: "dataset", levels, labels, aggregate: agg as "mean", error_bars: agg === "mean" ? spec.error_bars : "none", n_used: used, n_excluded: ctx.rows.length - used } };
}

function itemLevels(ctx: Ctx, items: string[]) {
  const first = variable(ctx, items[0]);
  const seen = new Set<string>();
  for (const it of items) for (const r of ctx.rows) {
    const x = ctx.cell(r, it);
    if (x !== null && x !== undefined && x !== "") seen.add(String(x));
  }
  let values = [...seen].sort((a, b) => +a - +b);
  const rr = first.response_range;
  if (rr && Number.isInteger(rr.min) && Number.isInteger(rr.max) && rr.max - rr.min <= 10) values = Array.from({ length: rr.max - rr.min + 1 }, (_, i) => String(rr.min + i));
  return { values, labels: values.map((v) => valueLabel(first, v)) };
}

function counts(ctx: Ctx, spec: Spec): ChartsDataResult {
  const ys = names(spec, "y");
  const xs = names(spec, "x");
  const rows: ChartRow[] = [];
  if (ys.length && !xs.length) {
    const lv = itemLevels(ctx, ys);
    const { groups, levels, labels } = groupKeys(ctx, spec, {}, ["color"]);
    for (const it of ys) {
      const ilab = labelOf(variable(ctx, it));
      for (const g of groups) {
        const vals = g.idx.map((i) => ctx.cell(ctx.rows[i], it)).filter((v) => v !== null && v !== "");
        lv.values.forEach((v, k) => {
          const c = vals.filter((x) => String(x) === v).length;
          rows.push({ ...g.key, x: ilab, color: lv.labels[k], count: c, n: vals.length, percent: vals.length ? (100 * c) / vals.length : null });
        });
      }
    }
    return { rows, meta: { chart_type: spec.chart_type, source: "dataset", levels: { x: ys.map((y) => labelOf(variable(ctx, y))), color: lv.labels, ...levels }, labels: { x: "Item", color: "Response", ...labels, value: "Count" } } };
  }
  need(xs.length === 1, "Put a grouping variable on X (and optionally another on Color/Group to stack by).");
  const outer = groupKeys(ctx, spec, { x: xs[0] }, ["color"]);
  const [cname] = names(spec, "color");
  const cat = cname ? category(ctx, cname) : null;
  for (const g of outer.groups) {
    const idx = cat ? g.idx.filter((i) => cat.values[i] !== null) : g.idx;
    for (const col of cat ? cat.levels : [null]) {
      const c = col === null ? idx.length : idx.filter((i) => cat!.values[i] === col).length;
      rows.push({ ...g.key, ...(col !== null ? { color: col } : {}), count: c, n: idx.length, percent: idx.length ? (100 * c) / idx.length : null });
    }
  }
  return { rows, meta: { chart_type: spec.chart_type, source: "dataset", levels: { ...outer.levels, ...(cat ? { color: cat.levels } : {}) }, labels: { ...outer.labels, ...(cat ? { color: cat.label } : {}), value: "Count" } } };
}

function likert(ctx: Ctx, spec: Spec): ChartsDataResult {
  const items = names(spec, "y").length ? names(spec, "y") : names(spec, "x");
  need(items.length, "Put one or more Likert items on the Y shelf.");
  const lv = itemLevels(ctx, items);
  need(lv.values.length >= 2, "These items need at least two different answers to draw a Likert chart.");
  const k = lv.values.length;
  const mid = (k - 1) / 2;
  const { groups, levels, labels } = groupKeys(ctx, spec, {}, ["color"]);
  const rows: ChartRow[] = [];
  for (const it of items) {
    const ilab = labelOf(variable(ctx, it));
    for (const g of groups) {
      const vals = g.idx.map((i) => ctx.cell(ctx.rows[i], it)).filter((v) => v !== null && v !== "").map(String);
      const n = vals.length;
      const cnt = lv.values.map((v) => vals.filter((x) => x === v).length);
      const pct = cnt.map((c) => (n ? (100 * c) / n : 0));
      let pos = -(pct.filter((_, i) => i < mid).reduce((a, b) => a + b, 0) + (k % 2 ? pct[mid] / 2 : 0));
      lv.values.forEach((v, i) => {
        rows.push({ ...g.key, item: ilab, item_variable: it, response: lv.labels[i], response_value: v, order: i, side: i < mid ? "negative" : i > mid ? "positive" : "neutral", count: cnt[i], n, percent: pct[i], start: pos, end: pos + pct[i] });
        pos += pct[i];
      });
    }
  }
  return { rows, meta: { chart_type: "likert_diverging", source: "dataset", levels: { item: items.map((i) => labelOf(variable(ctx, i))), response: lv.labels, ...levels }, labels: { item: "Item", response: "Response", ...labels, value: "Percent of responses" }, neutral: k % 2 ? lv.labels[mid] : null } };
}

function kde(x: number[], grid: number[], bw: number) {
  return grid.map((g) => x.reduce((a, v) => a + Math.exp(-0.5 * ((g - v) / bw) ** 2), 0) / (x.length * bw * Math.sqrt(2 * Math.PI)));
}
const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

function boxStats(x: number[]) {
  const s = [...x].sort((a, b) => a - b);
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  const inside = s.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  return { n: s.length, min: s[0], q1, median: quantile(s, 0.5), q3, max: s[s.length - 1], mean: mean(s), iqr, whisker_low: inside[0], whisker_high: inside[inside.length - 1], outliers: s.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr) };
}

function distribution(ctx: Ctx, spec: Spec): ChartsDataResult {
  const t = spec.chart_type;
  const boxLike = t === "box" || t === "violin";
  const groupX = boxLike && names(spec, "y").length > 0;
  const name = groupX ? names(spec, "y")[0] : (names(spec, "x")[0] ?? names(spec, "y")[0]);
  need(name, "Put a number variable on the X shelf.");
  const vals = numeric(ctx, name);
  const { groups, levels, labels } = groupKeys(ctx, spec, groupX && names(spec, "x").length ? { x: names(spec, "x")[0] } : {});
  labels.value = labelOf(variable(ctx, name));
  const rows: ChartRow[] = [];
  const meta: Record<string, unknown> = {};
  const series = groups.map((g) => ({ key: g.key, x: g.idx.map((i) => vals[i]).filter((v): v is number => v !== null) })).filter((g) => g.x.length);
  need(series.length, "There are no scores to summarise.");
  if (t === "histogram") {
    const all = series.flatMap((s) => s.x).sort((a, b) => a - b);
    const iqr = quantile(all, 0.75) - quantile(all, 0.25);
    const bins = (spec.customization.bins as number | undefined) || (iqr > 0 ? Math.max(1, Math.ceil((all[all.length - 1] - all[0]) / (2 * iqr * all.length ** (-1 / 3)))) : Math.ceil(Math.log2(all.length) + 1));
    const lo = all[0];
    const hi = all[all.length - 1] === lo ? lo + 1 : all[all.length - 1];
    const w = (hi - lo) / bins;
    for (const s of series) {
      const c = Array(bins).fill(0);
      for (const v of s.x) c[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
      c.forEach((n, i) => rows.push({ ...s.key, bin_start: lo + i * w, bin_end: lo + (i + 1) * w, count: n, percent: (100 * n) / s.x.length, density: n / (s.x.length * w) }));
    }
    Object.assign(meta, { bin_width: w, n_bins: bins });
  } else if (t === "density") {
    const withBw = series.filter((s) => s.x.length > 1).map((s) => ({ ...s, bw: s.x.length ** -0.2 * sd(s.x) * Number(spec.customization.bandwidth_adjust ?? 1) }));
    const lo = Math.min(...withBw.map((s) => Math.min(...s.x) - 3 * s.bw));
    const hi = Math.max(...withBw.map((s) => Math.max(...s.x) + 3 * s.bw));
    const grid = linspace(lo, hi, 128);
    for (const s of withBw) kde(s.x, grid, s.bw).forEach((d, i) => rows.push({ ...s.key, x: grid[i], density: d }));
    meta.bandwidths = withBw.map((s) => ({ ...s.key, bandwidth: s.bw, n: s.x.length }));
  } else if (t === "qq") {
    const lines = [];
    for (const s of series) {
      const x = [...s.x].sort((a, b) => a - b);
      const n = x.length;
      const a = n <= 10 ? 3 / 8 : 0.5;
      const theo = x.map((_, i) => normPpf((i + 1 - a) / (n + 1 - 2 * a)));
      x.forEach((v, i) => rows.push({ ...s.key, theoretical: theo[i], sample: v }));
      const slope = (quantile(x, 0.75) - quantile(x, 0.25)) / (normPpf(0.75) - normPpf(0.25));
      lines.push({ ...s.key, slope, intercept: quantile(x, 0.25) - slope * normPpf(0.25), x_min: theo[0], x_max: theo[n - 1] });
    }
    meta.lines = lines;
  } else {
    for (const s of series) {
      const { outliers, ...b } = boxStats(s.x);
      if (t === "box") {
        rows.push({ ...s.key, kind: "box", ...b, n_outliers: outliers.length });
        for (const v of outliers) rows.push({ ...s.key, kind: "outlier", value: v });
      } else {
        rows.push({ ...s.key, kind: "box", ...b });
        if (s.x.length > 1 && b.max > b.min) {
          const grid = linspace(b.min, b.max, 64);
          kde(s.x, grid, s.x.length ** -0.2 * sd(s.x) * Number(spec.customization.bandwidth_adjust ?? 1)).forEach((d, i) => rows.push({ ...s.key, kind: "density", value: grid[i], density: d }));
        }
      }
    }
  }
  const nUsed = series.reduce((a, s) => a + s.x.length, 0);
  return { rows, meta: { chart_type: t, source: "dataset", levels, labels, n_used: nUsed, n_excluded: ctx.rows.length - nUsed, ...meta } };
}

function scatter(ctx: Ctx, spec: Spec): ChartsDataResult {
  const [xn] = names(spec, "x");
  const [yn] = names(spec, "y");
  need(xn && yn, "Put one number variable on X and one on Y to draw a scatter plot.");
  const xv = numeric(ctx, xn);
  const yv = numeric(ctx, yn);
  const { groups, levels, labels } = groupKeys(ctx, spec);
  labels.x = labelOf(variable(ctx, xn));
  labels.y = labelOf(variable(ctx, yn));
  const rows: ChartRow[] = [];
  const fits = [];
  const fitKind = (spec.customization.fit_line as string | undefined) ?? "linear";
  for (const g of groups) {
    const pts = g.idx.filter((i) => xv[i] !== null && yv[i] !== null).map((i) => [xv[i]!, yv[i]!]);
    pts.forEach(([x, y]) => rows.push({ ...g.key, x, y }));
    if (pts.length < 3 || fitKind === "none") continue;
    const mx = mean(pts.map((p) => p[0]));
    const my = mean(pts.map((p) => p[1]));
    const sxx = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
    const syy = pts.reduce((a, [, y]) => a + (y - my) ** 2, 0);
    const sxy = pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
    const slope = sxx ? sxy / sxx : NaN;
    const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
    const xs = pts.map((p) => p[0]);
    const x_min = Math.min(...xs);
    const x_max = Math.max(...xs);
    const intercept = my - slope * mx;
    fits.push({ ...g.key, n: pts.length, slope: fin(slope), intercept: fin(intercept), r: fin(r), r2: fin(r * r), x_min, x_max, points: [x_min, x_max].map((x) => ({ x, y: intercept + slope * x })) });
  }
  need(rows.length, "No rows have both of these variables filled in.");
  return { rows, meta: { chart_type: "scatter", source: "dataset", levels, labels, fits, fit_line: fitKind, n_used: rows.length, n_excluded: ctx.rows.length - rows.length } };
}

function correlation(ctx: Ctx, spec: Spec): ChartsDataResult {
  const vars = [...new Set([...names(spec, "x"), ...names(spec, "y")])];
  need(vars.length >= 2, "Put two or more number variables on the X shelf to draw a correlation heatmap.");
  const cols = vars.map((v) => numeric(ctx, v));
  const labels = vars.map((v) => labelOf(variable(ctx, v)));
  const rows: ChartRow[] = [];
  vars.forEach((a, i) =>
    vars.forEach((b, j) => {
      const pts = ctx.rows.map((_, k) => [cols[i][k], cols[j][k]]).filter(([p, q]) => p !== null && q !== null) as number[][];
      let r: number | null = null;
      if (i === j) r = 1;
      else if (pts.length >= 3) {
        const mx = mean(pts.map((p) => p[0]));
        const my = mean(pts.map((p) => p[1]));
        const sxy = pts.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0);
        const sxx = pts.reduce((s, [x]) => s + (x - mx) ** 2, 0);
        const syy = pts.reduce((s, [, y]) => s + (y - my) ** 2, 0);
        r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
      }
      rows.push({ row: labels[i], col: labels[j], row_variable: a, col_variable: b, row_index: i, col_index: j, r, n: pts.length });
    }),
  );
  return { rows, meta: { chart_type: "correlation_heatmap", source: "dataset", levels: { row: labels, col: labels }, labels: { value: "Pearson r" }, method: "pearson" } };
}

function fromResult(result: AnalysisResult | undefined, spec: Spec): ChartsDataResult {
  if (!result) throw new MockChartError("That analysis result isn't stored in this project.", -32002);
  const cd = result.chart_data as Record<string, Record<string, unknown>[]>;
  if (spec.chart_type === "scree") {
    need(result.analysis_id === "validity.efa" && cd.scree, "A scree plot needs an exploratory factor analysis (EFA) from the Test Log.");
    const series = ["Eigenvalues (correlation matrix)", "Factor eigenvalues", "Parallel analysis (95th percentile)"];
    const rows = cd.scree.flatMap((r) => [
      { number: r.number as number, series: series[0], eigenvalue: r.eigenvalue as number },
      { number: r.number as number, series: series[1], eigenvalue: r.factor_eigenvalue as number },
      { number: r.number as number, series: series[2], eigenvalue: r.simulated_p95 as number },
    ]);
    return { rows, meta: { chart_type: "scree", source: "analysis", levels: { series }, labels: { x: "Factor number", value: "Eigenvalue" } } };
  }
  need(result.analysis_id === "validity.cfa" && cd.path_diagram, "A path diagram needs a confirmatory factor analysis (CFA) from the Test Log.");
  const nodes = cd.path_diagram.filter((r) => r.kind === "node");
  const edges = cd.path_diagram.filter((r) => r.kind === "edge");
  const observed = nodes.filter((n) => n.node_type === "observed");
  const pos = new Map<string, [number, number]>(observed.map((n, i) => [String(n.id), [i, 1]]));
  for (const f of nodes.filter((n) => n.node_type === "latent")) {
    const xs = edges.filter((e) => e.from === f.id && e.edge_type === "loading").map((e) => pos.get(String(e.to))?.[0] ?? 0);
    pos.set(String(f.id), [xs.length ? mean(xs) : 0, 0]);
  }
  const rows: ChartRow[] = nodes.map((n) => ({ kind: "node", id: String(n.id), label: String(n.label), node_type: String(n.node_type), x: pos.get(String(n.id))![0], y: pos.get(String(n.id))![1], residual: (n.residual as number | null) ?? null, residual_label: n.residual == null ? null : (n.residual as number).toFixed(2).replace(/^(-?)0\./, "$1.") }));
  edges.forEach((e, k) => {
    const [x1, y1] = pos.get(String(e.from))!;
    const [x2, y2] = pos.get(String(e.to))!;
    const w = e.weight as number;
    rows.push({ kind: "edge", id: `e${k}`, from: String(e.from), to: String(e.to), edge_type: String(e.edge_type), x: x1, y: y1 + 0.12, x2, y2: y2 - 0.1, weight: w, label: w.toFixed(2).replace(/^(-?)0\./, "$1."), label_x: x1 + 0.6 * (x2 - x1), label_y: y1 + 0.6 * (y2 - y1), p: (e.p as number) ?? null, marker: !!e.marker });
  });
  return { rows, meta: { chart_type: "cfa_path", source: "analysis", labels: {}, n_items: observed.length, n_factors: nodes.length - observed.length } };
}

/** `charts.data` for the mock engine. */
export function mockChartsData(p: ChartsDataParams, meta: DatasetMeta | null, cell: Cell | null, nRows: number, results: Map<string, AnalysisResult>): ChartsDataResult {
  const spec = p.spec;
  if (spec.chart_type === "scree" || spec.chart_type === "cfa_path") {
    need(spec.source.kind === "analysis" && spec.source.test_log_entry_id, "Pick a saved factor analysis from the Test Log for this chart.");
    return fromResult(results.get(spec.source.test_log_entry_id!), spec);
  }
  need(meta && cell, "Open a dataset to draw this chart.");
  if (p.snapshot_id !== meta!.snapshot_id) throw new MockChartError("The data changed since this chart was set up; please try again.", -32002);
  let rows = Array.from({ length: nRows }, (_, i) => i);
  for (const cond of spec.subset) {
    const v = variable({ meta: meta!, cell: cell!, rows }, cond.variable);
    rows = rows.filter((r) => {
      const x = cell!(r, cond.variable);
      const hit = x !== null && cond.values.some((w) => String(w) === String(x) || valueLabel(v, x) === String(w));
      return cond.op === "in" ? hit : !hit;
    });
  }
  const ctx: Ctx = { meta: meta!, cell: cell!, rows };
  switch (spec.chart_type) {
    case "bar":
    case "grouped_bar":
    case "line":
    case "interaction":
      return means(ctx, spec);
    case "stacked_bar":
    case "percent_bar":
      return counts(ctx, spec);
    case "likert_diverging":
      return likert(ctx, spec);
    case "scatter":
      return scatter(ctx, spec);
    case "correlation_heatmap":
      return correlation(ctx, spec);
    default:
      return distribution(ctx, spec);
  }
}
