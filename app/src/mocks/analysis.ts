/**
 * Mock `analysis.list` / `analysis.run` for mock mode and e2e: real arithmetic (means, SDs,
 * Welch/Student t, Mann-Whitney U with a normal approximation) on the mock dataset, shaped
 * exactly like the engine's AnalysisResult. Normality uses a skewness/kurtosis screen labelled
 * as such - the engine's Shapiro-Wilk is the real thing.
 */
import type {
  AnalysisRequest,
  AnalysisResult,
  ApaTable,
  AssumptionResult,
  CellValue,
  DatasetMeta,
  EffectSize,
  GroupDescriptives,
  RichText,
  TableCell,
} from "@/contracts";
import type { AnalysisInfo } from "@/lib/analysisRpc";

const R = (text: string, italic = false) => ({ text, italic });

export const MOCK_ANALYSES: AnalysisInfo[] = [
  { analysis_id: "descriptives", label: "Descriptive statistics", layouts: [{ name: "default", roles: [{ role: "variables", min: 1, max: null, description: "Variables to summarise" }, { role: "group", min: 0, max: 3, description: "Split by" }] }], options: {} },
  { analysis_id: "mann_whitney", label: "Mann-Whitney U test", layouts: [{ name: "default", roles: [{ role: "outcome", min: 1, max: 1, description: "Scores to compare" }, { role: "group", min: 1, max: 1, description: "Grouping variable with exactly two groups" }] }], options: { levels: "Group values" } },
  { analysis_id: "t_test.independent", label: "Independent-samples t test", layouts: [{ name: "default", roles: [{ role: "outcome", min: 1, max: 1, description: "Scores to compare" }, { role: "group", min: 1, max: 1, description: "Grouping variable with exactly two groups" }] }], options: { variant: "welch (default) or student", levels: "Group values", reference_group: "First group" } },
  { analysis_id: "t_test.one_sample", label: "One-sample t test", layouts: [{ name: "default", roles: [{ role: "outcome", min: 1, max: 1, description: "Scores" }] }], options: { test_value: "Value to compare against" } },
  { analysis_id: "t_test.paired", label: "Paired-samples t test", layouts: [{ name: "wide", roles: [{ role: "measures", min: 2, max: 2, description: "Two score columns for the same people" }] }], options: { levels: "Time values" } },
];

// --- small numeric toolkit -------------------------------------------------------------------

const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
const mean = (x: number[]) => sum(x) / x.length;
const variance = (x: number[]) => {
  const m = mean(x);
  return sum(x.map((v) => (v - m) ** 2)) / (x.length - 1);
};
const quantile = (sorted: number[], q: number) => {
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  return sorted[lo] + (h - lo) * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo]);
};

function logGamma(z: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const cj of c) ser += cj / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

const pT = (t: number, df: number) => ibeta(df / (df + t * t), df / 2, 0.5); // two-sided
const pF = (f: number, d1: number, d2: number) => ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** Inverse standard normal CDF (Acklam). */
function qnorm(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -qnorm(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** t quantile via bisection on the two-sided p. */
function qt(p2: number, df: number): number {
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (pT(mid, df) > p2) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// --- APA formatting ----------------------------------------------------------------------------

const f2 = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : x.toFixed(2));
const noZero = (s: string) => s.replace(/^(-?)0\./, "$1.");
export const fmtP = (p: number | null) => (p === null ? "—" : p < 0.001 ? "< .001" : noZero(p.toFixed(3)));
const pRun = (p: number): RichText => (p < 0.001 ? [R("p", true), R(" < .001")] : [R("p", true), R(` = ${fmtP(p)}`)]);
const dfText = (df: number) => (Number.isInteger(df) ? String(df) : df.toFixed(2));
const numCell = (v: number | null, display = f2(v)): TableCell => ({ type: "number", value: v, display });
const textCell = (t: string): TableCell => ({ type: "text", text: [R(t)] });
const columns = (heads: string[]): ApaTable["columns"] => {
  const cols = heads.map((c, i) => ({ key: `c${i}`, header: [R(c, i > 0)], align: (i === 0 ? "left" : "right") as "left" | "right" }));
  return [cols[0], ...cols.slice(1)];
};

function magnitude(d: number, kind: "d" | "r"): EffectSize["interpretation"] {
  const a = Math.abs(d);
  const cut = kind === "d" ? [0.2, 0.5, 0.8] : [0.1, 0.3, 0.5];
  const m = a < cut[0] ? "negligible" : a < cut[1] ? "small" : a < cut[2] ? "medium" : "large";
  return {
    magnitude: m,
    benchmark: "Cohen (1988)",
    text: `By common benchmarks this is a ${m === "negligible" ? "negligible" : `${m}-sized`} difference. These size labels are general rules of thumb; in education research effects are usually judged against similar studies.`,
  };
}

// --- data access -------------------------------------------------------------------------------

type Cell = (r: number, col: string) => CellValue;

function numericValues(meta: DatasetMeta, cell: Cell, nRows: number, name: string, rows?: number[]): number[] {
  const v = meta.variables.find((x) => x.name === name);
  const missing = new Set((v?.missing_codes ?? []).map((m) => String(m)));
  const out: number[] = [];
  for (const r of rows ?? Array.from({ length: nRows }, (_, i) => i)) {
    const raw = cell(r, name);
    if (raw === null || raw === "" || missing.has(String(raw))) continue;
    const x = Number(raw);
    if (Number.isFinite(x)) out.push(x);
  }
  return out;
}

function groupsOf(meta: DatasetMeta, cell: Cell, nRows: number, outcome: string, group: string): { level: string; values: number[] }[] {
  const byLevel = new Map<string, number[]>();
  for (let r = 0; r < nRows; r++) {
    const g = cell(r, group);
    if (g === null || g === "") continue;
    const key = String(g);
    if (!byLevel.has(key)) byLevel.set(key, []);
    byLevel.get(key)!.push(r);
  }
  const v = meta.variables.find((x) => x.name === group);
  const order = [...(v?.value_labels.map((l) => String(l.value)) ?? []), ...(meta.stacking?.time_variable === group ? meta.stacking.levels.map((l) => l.label) : [])];
  const levels = [...byLevel.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.localeCompare(b);
  });
  return levels.map((level) => ({ level, values: numericValues(meta, cell, nRows, outcome, byLevel.get(level)) }));
}

function describe(variable: string, group: Record<string, string>, label: string, x: number[], nMissing: number): GroupDescriptives {
  const n = x.length;
  const s = [...x].sort((a, b) => a - b);
  const m = n ? mean(x) : null;
  const sd = n > 1 ? Math.sqrt(variance(x)) : null;
  const se = sd !== null ? sd / Math.sqrt(n) : null;
  const tq = n > 1 ? qt(0.05, n - 1) : null;
  const skew = n > 2 && sd ? (n / ((n - 1) * (n - 2))) * sum(x.map((v) => ((v - m!) / sd) ** 3)) : null;
  const q1 = n ? quantile(s, 0.25) : null;
  const q3 = n ? quantile(s, 0.75) : null;
  return {
    variable,
    group,
    label,
    n,
    n_missing: nMissing,
    mean: m,
    sd,
    se,
    ci: m !== null && se !== null && tq !== null ? { level: 0.95, lower: m - tq * se, upper: m + tq * se } : null,
    median: n ? quantile(s, 0.5) : null,
    q1,
    q3,
    iqr: q1 !== null && q3 !== null ? q3 - q1 : null,
    min: n ? s[0] : null,
    max: n ? s[n - 1] : null,
    skewness: skew,
    kurtosis: null,
  };
}

function normalityCheck(x: number[], label: string, scope: AssumptionResult["applies_to"], key: string, chartData: Record<string, Record<string, number>[]>): AssumptionResult {
  const n = x.length;
  const m = mean(x);
  const sd = Math.sqrt(variance(x));
  const skew = (n / ((n - 1) * (n - 2))) * sum(x.map((v) => ((v - m) / sd) ** 3));
  const verdict: AssumptionResult["verdict"] = Math.abs(skew) < 1 ? (n >= 100 ? "caution" : "passed") : "failed";
  const s = [...x].sort((a, b) => a - b);
  chartData[`qq_${key}`] = s.map((v, i) => ({ theoretical: qnorm((i + 1 - 0.375) / (n + 0.25)), sample: v }));
  const bins = Math.max(4, Math.ceil(Math.log2(n) + 1));
  const lo = s[0];
  const width = (s[n - 1] - lo) / bins || 1;
  chartData[`hist_${key}`] = Array.from({ length: bins }, (_, b) => ({
    bin_start: lo + b * width,
    bin_end: lo + (b + 1) * width,
    count: s.filter((v) => (b === bins - 1 ? v >= lo + b * width : v >= lo + b * width && v < lo + (b + 1) * width)).length,
  }));
  const explanation =
    verdict === "passed"
      ? `The ${label} scores look roughly bell-shaped (skewness ${f2(skew)}), so this assumption looks reasonable.`
      : verdict === "caution"
        ? `With ${n} scores, even small bumps can look significant. The ${label} scores look roughly bell-shaped, so check the plots rather than relying on the test alone.`
        : `The ${label} scores are clearly lopsided (skewness ${f2(skew)}). Check the histogram and Q-Q plot, and consider the rank-based (nonparametric) alternative.`;
  return {
    schema_version: 1,
    assumption: "normality",
    label: "Normality",
    test_used: { key: "skew_screen", label: "Skewness screen (mock engine)" },
    statistic: { symbol: "skew", value: skew, df: [] },
    p: null,
    verdict,
    explanation,
    applies_to: scope,
    chart_refs: [
      { chart_type: "qq", title: `Q-Q plot: ${label}`, data_key: `qq_${key}` },
      { chart_type: "histogram", title: `Histogram: ${label}`, data_key: `hist_${key}` },
    ],
  };
}

function leveneBF(groups: number[][]): { F: number; df1: number; df2: number; p: number } {
  const z = groups.map((g) => {
    const s = [...g].sort((a, b) => a - b);
    const med = quantile(s, 0.5);
    return g.map((v) => Math.abs(v - med));
  });
  const all = z.flat();
  const grand = mean(all);
  const k = z.length;
  const N = all.length;
  const between = sum(z.map((g) => g.length * (mean(g) - grand) ** 2));
  const within = sum(z.map((g) => sum(g.map((v) => (v - mean(g)) ** 2))));
  const F = (between / (k - 1)) / (within / (N - k));
  return { F, df1: k - 1, df2: N - k, p: pF(F, k - 1, N - k) };
}

function invalid(message: string): never {
  throw { kind: "rpc", code: -32003, message, data: { type: "InvalidParams" } };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function baseResult(req: AnalysisRequest, meta: DatasetMeta): AnalysisResult {
  return {
    schema_version: 1,
    analysis_id: req.analysis_id,
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
    inputs: { request: req, dataset_id: meta.dataset_id, snapshot_id: meta.snapshot_id, n_used: 0, n_excluded: 0, n_by_group: [] },
    engine_version: "0.1.0-mock",
    timestamp: new Date().toISOString(),
  };
}

function twoGroup(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number) {
  const outcome = req.variables.outcome[0];
  const gname = req.variables.group[0];
  const groups = groupsOf(meta, cell, nRows, outcome, gname);
  if (groups.length !== 2) invalid(`This test needs exactly two groups, but "${gname}" has ${groups.length}.`);
  const [a, b] = groups;
  if (a.values.length < 2 || b.values.length < 2) invalid("Each group needs at least two scores.");
  return { outcome, gname, a, b, n: a.values.length + b.values.length, excluded: nRows - a.values.length - b.values.length };
}

function independentT(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): AnalysisResult {
  const out = baseResult(req, meta);
  const { outcome, gname, a, b, n, excluded } = twoGroup(req, meta, cell, nRows);
  const [n1, n2] = [a.values.length, b.values.length];
  const [m1, m2] = [mean(a.values), mean(b.values)];
  const [v1, v2] = [variance(a.values), variance(b.values)];
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const t = (m1 - m2) / se;
  const df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
  const p = pT(t, df);
  const sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
  const tStudent = (m1 - m2) / (sp * Math.sqrt(1 / n1 + 1 / n2));
  const d = (m1 - m2) / sp;
  const J = 1 - 3 / (4 * (n1 + n2) - 9);
  const g = d * J;
  const seG = Math.sqrt((n1 + n2) / (n1 * n2) + (g * g) / (2 * (n1 + n2)));
  const tq = qt(0.05, df);
  out.statistics = [
    { key: "welch_t", label: "Welch's t", symbol: "t", value: t, df: [df], p, term: null },
    { key: "student_t", label: "Student's t", symbol: "t", value: tStudent, df: [n1 + n2 - 2], p: pT(tStudent, n1 + n2 - 2), term: null },
  ];
  out.effect_sizes = [
    { key: "hedges_g", label: "Hedges' g", symbol: "g", value: g, ci: { level: 0.95, lower: g - 1.96 * seG, upper: g + 1.96 * seG }, term: null, interpretation: magnitude(g, "d") },
    { key: "cohens_d", label: "Cohen's d", symbol: "d", value: d, ci: { level: 0.95, lower: d - 1.96 * seG, upper: d + 1.96 * seG }, term: null, interpretation: magnitude(d, "d") },
    { key: "mean_difference", label: "Mean difference", symbol: "Mdiff", value: m1 - m2, ci: { level: 0.95, lower: m1 - m2 - tq * se, upper: m1 - m2 + tq * se }, term: null, interpretation: null },
  ];
  const ga = { [gname]: a.level };
  const gb = { [gname]: b.level };
  out.descriptives.continuous = [describe(outcome, ga, a.level, a.values, 0), describe(outcome, gb, b.level, b.values, 0)];
  out.assumptions = [
    normalityCheck(a.values, a.level, { kind: "group", label: a.level, group: ga, n: n1 }, slug(a.level), out.chart_data as never),
    normalityCheck(b.values, b.level, { kind: "group", label: b.level, group: gb, n: n2 }, slug(b.level), out.chart_data as never),
  ];
  const lev = leveneBF([a.values, b.values]);
  out.assumptions.push({
    schema_version: 1,
    assumption: "homogeneity_of_variance",
    label: "Equal spread (homogeneity of variance)",
    test_used: { key: "levene_brown_forsythe", label: "Levene's test (Brown-Forsythe)" },
    statistic: { symbol: "F", value: lev.F, df: [lev.df1, lev.df2] },
    p: lev.p,
    verdict: lev.p < req.alpha ? "failed" : "passed",
    explanation:
      lev.p < req.alpha
        ? `The groups' scores are spread out by different amounts (p = ${fmtP(lev.p)}). Welch's t, which Statly reports, does not assume equal spread.`
        : `The groups' scores are spread out by similar amounts (p = ${fmtP(lev.p)}), so this assumption looks reasonable.`,
    applies_to: { kind: "overall", label: `${a.level} vs ${b.level}`, group: null, n },
    chart_refs: [],
  });
  const [hi, lo] = m1 >= m2 ? [a, b] : [b, a];
  const sig = p < req.alpha;
  out.plain_language_summary = `The ${hi.level} group scored ${sig ? "higher" : "slightly higher"} on average (${f2(mean(hi.values))}) than the ${lo.level} group (${f2(mean(lo.values))}). ${
    sig ? `This difference is unlikely to be due to chance alone (p ${p < 0.001 ? "< .001" : `= ${fmtP(p)}`}).` : `This difference could easily be due to chance (p = ${fmtP(p)}).`
  } The size of the difference was ${magnitude(g, "d")!.magnitude} by common benchmarks.`;
  out.apa_sentence = [
    R("An independent-samples Welch "),
    R("t", true),
    R(` test showed that ${outcome} scores were ${sig ? "significantly" : "not significantly"} higher for ${hi.level} (`),
    R("M", true),
    R(` = ${f2(mean(hi.values))}, `),
    R("SD", true),
    R(` = ${f2(Math.sqrt(variance(hi.values)))}) than for ${lo.level} (`),
    R("M", true),
    R(` = ${f2(mean(lo.values))}, `),
    R("SD", true),
    R(` = ${f2(Math.sqrt(variance(lo.values)))}), `),
    R("t", true),
    R(`(${dfText(df)}) = ${f2(t)}, `),
    ...pRun(p),
    R(", "),
    R("g", true),
    R(` = ${f2(g)}, 95% CI [${f2(g - 1.96 * seG)}, ${f2(g + 1.96 * seG)}].`),
  ];
  out.apa_table = groupTable(`Comparison of ${outcome} by ${gname}`, outcome, [a, b], t, df, p, g);
  out.inputs = { ...out.inputs, n_used: n, n_excluded: excluded, n_by_group: [{ group: ga, n: n1 }, { group: gb, n: n2 }] };
  if (Math.min(n1, n2) < 20) out.warnings.push({ code: "small_sample", severity: "caution", message: "At least one group has fewer than 20 people, so results may be unstable." });
  return out;
}

function groupTable(title: string, outcome: string, g: { level: string; values: number[] }[], t: number, df: number, p: number, es: number): ApaTable {
  const cols = ["Variable", ...g.flatMap(() => ["M", "SD"]), "t", "df", "p", "g"];
  return {
    number: 1,
    title,
    columns: columns(cols),
    column_groups: g.map((x, i) => ({ label: [R(x.level)], first_column: 1 + i * 2, span: 2 })),
    rows: [
      {
        cells: [
          textCell(outcome),
          ...g.flatMap((x) => [numCell(mean(x.values)), numCell(Math.sqrt(variance(x.values)))]),
          numCell(t),
          numCell(df, dfText(df)),
          { type: "p_value", value: p, display: fmtP(p) },
          numCell(es),
        ],
        indent: 0,
        kind: "data",
      },
    ],
    notes: { general: [R("Welch's "), R("t", true), R(" test; "), R("g", true), R(" = Hedges' g.")], specific: [], probability: [] },
  };
}

function mannWhitney(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): AnalysisResult {
  const out = baseResult(req, meta);
  const { outcome, gname, a, b, n, excluded } = twoGroup(req, meta, cell, nRows);
  const all = [...a.values.map((v) => ({ v, g: 0 })), ...b.values.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array(all.length).fill(0);
  let tieTerm = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    for (let k = i; k <= j; k++) ranks[k] = (i + j) / 2 + 1;
    const tcount = j - i + 1;
    tieTerm += tcount ** 3 - tcount;
    i = j + 1;
  }
  const [n1, n2] = [a.values.length, b.values.length];
  const R1 = sum(all.map((x, i) => (x.g === 0 ? ranks[i] : 0)));
  const U = R1 - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n1 + n2 + 1 - tieTerm / ((n1 + n2) * (n1 + n2 - 1))));
  const z = (U - mu - Math.sign(U - mu) * 0.5) / sigma;
  const p = Math.min(1, 2 * (1 - normCdf(Math.abs(z))));
  const rb = (2 * U) / (n1 * n2) - 1;
  out.statistics = [{ key: "U", label: "Mann-Whitney U", symbol: "U", value: U, df: [], p, term: null }];
  out.effect_sizes = [{ key: "rank_biserial", label: "Rank-biserial correlation", symbol: "r", value: rb, ci: { level: 0.95, lower: Math.max(-1, rb - 0.25), upper: Math.min(1, rb + 0.25) }, term: null, interpretation: magnitude(rb, "r") }];
  const ga = { [gname]: a.level };
  const gb = { [gname]: b.level };
  out.descriptives.continuous = [describe(outcome, ga, a.level, a.values, 0), describe(outcome, gb, b.level, b.values, 0)];
  const med = (x: number[]) => quantile([...x].sort((p1, p2) => p1 - p2), 0.5);
  out.plain_language_summary = `Scores in the ${a.level} group (median ${f2(med(a.values))}) and the ${b.level} group (median ${f2(med(b.values))}) ${p < req.alpha ? "differed" : "did not clearly differ"} (p ${p < 0.001 ? "< .001" : `= ${fmtP(p)}`}).`;
  out.apa_sentence = [
    R(`A Mann-Whitney U test indicated that ${outcome} ${p < req.alpha ? "differed significantly" : "did not differ significantly"} between ${a.level} (`),
    R("Mdn", true),
    R(` = ${f2(med(a.values))}) and ${b.level} (`),
    R("Mdn", true),
    R(` = ${f2(med(b.values))}), `),
    R("U", true),
    R(` = ${f2(U)}, `),
    ...pRun(p),
    R(", "),
    R("r", true),
    R(` = ${noZero(rb.toFixed(2))}.`),
  ];
  out.apa_table = {
    number: 1,
    title: `Mann-Whitney U Test of ${outcome} by ${gname}`,
    columns: columns(["Variable", "Mdn", "Mdn", "U", "p", "r"]),
    column_groups: [
      { label: [R(a.level)], first_column: 1, span: 1 },
      { label: [R(b.level)], first_column: 2, span: 1 },
    ],
    rows: [{ cells: [textCell(outcome), numCell(med(a.values)), numCell(med(b.values)), numCell(U), { type: "p_value", value: p, display: fmtP(p) }, numCell(rb, noZero(rb.toFixed(2)))], indent: 0, kind: "data" }],
    notes: { general: [R("Rank-biserial "), R("r", true), R(" is the effect size.")], specific: [], probability: [] },
  };
  out.inputs = { ...out.inputs, n_used: n, n_excluded: excluded, n_by_group: [{ group: ga, n: n1 }, { group: gb, n: n2 }] };
  if (tieTerm > 0) out.warnings.push({ code: "ties_present", severity: "info", message: "Some scores were tied; Statly used the standard tie correction." });
  return out;
}

function descriptivesRun(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): AnalysisResult {
  const out = baseResult(req, meta);
  const vars = req.variables.variables;
  out.descriptives.continuous = vars.map((v) => {
    const x = numericValues(meta, cell, nRows, v);
    return describe(v, {}, v, x, nRows - x.length);
  });
  out.plain_language_summary = `Summary statistics for ${vars.join(", ")}.`;
  out.apa_table = {
    number: 1,
    title: "Descriptive Statistics",
    columns: columns(["Variable", "n", "M", "SD"]),
    column_groups: [],
    rows: out.descriptives.continuous.map((d) => ({ cells: [textCell(d.variable), numCell(d.n, String(d.n)), numCell(d.mean), numCell(d.sd)], indent: 0, kind: "data" as const })),
    notes: { general: null, specific: [], probability: [] },
  };
  out.inputs = { ...out.inputs, n_used: nRows };
  return out;
}

export function mockAnalysisRun(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): AnalysisResult {
  const info = MOCK_ANALYSES.find((a) => a.analysis_id === req.analysis_id);
  if (!info) invalid(`Unknown analysis '${req.analysis_id}'.`);
  for (const names of Object.values(req.variables)) {
    for (const n of names) if (!meta.variables.some((v) => v.name === n)) invalid(`There is no variable called "${n}".`);
  }
  switch (req.analysis_id) {
    case "t_test.independent":
      return independentT(req, meta, cell, nRows);
    case "mann_whitney":
      return mannWhitney(req, meta, cell, nRows);
    case "descriptives":
      return descriptivesRun(req, meta, cell, nRows);
    default:
      invalid(`The mock engine can't run ${info.label} yet.`);
  }
}
