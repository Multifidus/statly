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
  {
    analysis_id: "t_test.paired",
    label: "Paired-samples t test",
    layouts: [
      { name: "wide", roles: [{ role: "measures", min: 2, max: 2, description: "Two score columns for the same people (e.g. pre, post)" }] },
      {
        name: "long",
        roles: [
          { role: "outcome", min: 1, max: 1, description: "Scores" },
          { role: "time", min: 1, max: 1, description: "Time point with two levels" },
          { role: "subject_id", min: 1, max: 1, description: "Participant ID linking rows across time" },
        ],
      },
    ],
    options: { levels: "Long layout: the two time values, in the order to compare (first minus second)." },
  },
  {
    analysis_id: "wilcoxon_signed_rank",
    label: "Wilcoxon signed-rank test",
    layouts: [
      { name: "wide", roles: [{ role: "measures", min: 2, max: 2, description: "Two score columns for the same people (e.g. pre, post)" }] },
      {
        name: "long",
        roles: [
          { role: "outcome", min: 1, max: 1, description: "Scores" },
          { role: "time", min: 1, max: 1, description: "Time point with two levels" },
          { role: "subject_id", min: 1, max: 1, description: "Participant ID linking rows across time" },
        ],
      },
    ],
    options: { levels: "Long layout: the two time values, in the order to compare (first minus second)." },
  },
  {
    analysis_id: "anova.one_way",
    label: "One-way ANOVA",
    layouts: [
      {
        name: "default",
        roles: [
          { role: "outcome", min: 1, max: 1, description: "Scores to compare" },
          { role: "group", min: 1, max: 1, description: "Grouping variable with two or more groups" },
        ],
      },
    ],
    options: { levels: "Group (or long-layout time) values to include, in display order." },
  },
  {
    analysis_id: "kruskal_wallis",
    label: "Kruskal-Wallis test",
    layouts: [
      {
        name: "default",
        roles: [
          { role: "outcome", min: 1, max: 1, description: "Scores to compare (ordinal or numeric)" },
          { role: "group", min: 1, max: 1, description: "Grouping variable with two or more groups" },
        ],
      },
    ],
    options: {
      levels: "Group values to include, in display order.",
      bootstrap_seed: "Seed for the bootstrap CI (default 12345; R: set.seed).",
      bootstrap_iterations: "Bootstrap resamples for the CI (default 200, as effectsize).",
    },
  },
  {
    analysis_id: "posthoc.tukey",
    label: "Tukey HSD post hoc test",
    layouts: [
      {
        name: "default",
        roles: [
          { role: "outcome", min: 1, max: 1, description: "Scores to compare" },
          { role: "group", min: 1, max: 1, description: "Grouping variable with two or more groups" },
        ],
      },
    ],
    options: { levels: "Group (or long-layout time) values to include, in display order." },
  },
  {
    analysis_id: "anova.mixed",
    label: "Mixed ANOVA (between x within)",
    layouts: [
      {
        name: "wide",
        roles: [
          { role: "measures", min: 2, max: null, description: "Score columns for the same people, in time order" },
          { role: "between", min: 1, max: 1, description: "Grouping variable (e.g. program vs control)" },
        ],
      },
      {
        name: "long",
        roles: [
          { role: "outcome", min: 1, max: 1, description: "Scores" },
          { role: "time", min: 1, max: 1, description: "Time point (two or more levels)" },
          { role: "subject_id", min: 1, max: 1, description: "Participant ID linking rows across time" },
          { role: "between", min: 1, max: 1, description: "Grouping variable (e.g. program vs control)" },
        ],
      },
    ],
    options: {},
  },
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

/** Regularized lower incomplete gamma P(a, x) via series (Numerical Recipes). */
function gammaSeries(a: number, x: number): number {
  if (x <= 0) return 0;
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 1; n <= 200; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/** Regularized upper incomplete gamma Q(a, x) via continued fraction (Numerical Recipes). */
function gammaCf(a: number, x: number): number {
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Chi-square survival function (upper tail), used for the Kruskal-Wallis H statistic. */
function chi2Sf(stat: number, df: number): number {
  if (!Number.isFinite(stat) || stat <= 0) return 1;
  const a = df / 2;
  const x = stat / 2;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaCf(a, x);
}

/** Ranks with ties averaged; also returns the tie-correction term sum(t^3 - t) over tied groups. */
function rankWithTies(values: number[]): { ranks: number[]; tieTerm: number } {
  const order = values.map((_, i) => i).sort((i, j) => values[i] - values[j]);
  const ranks = new Array<number>(values.length);
  let tieTerm = 0;
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]] = r;
    const t = j - i + 1;
    tieTerm += t ** 3 - t;
    i = j + 1;
  }
  return { ranks, tieTerm };
}

/** Approximate normal-based CI for a bounded [0, 1] effect size (eta-family). The real engine
 * inverts the noncentral F/chi-square distribution (effectsize package); this mock uses a
 * simple normal-approximation SE instead, which is good enough to render but not bit-exact. */
function boundedCi(value: number, se: number): { level: 0.95; lower: number; upper: number } {
  return { level: 0.95, lower: Math.max(0, value - 1.96 * se), upper: Math.min(1, value + 1.96 * se) };
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

function magnitude(d: number, kind: "d" | "r" | "f" | "eta"): EffectSize["interpretation"] {
  const a = Math.abs(d);
  const cuts = { d: [0.2, 0.5, 0.8], r: [0.1, 0.3, 0.5], f: [0.1, 0.25, 0.4], eta: [0.01, 0.06, 0.14] } as const;
  const cut = cuts[kind];
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

function kGroups(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number) {
  const outcome = req.variables.outcome[0];
  const gname = req.variables.group[0];
  const groups = groupsOf(meta, cell, nRows, outcome, gname).filter((g) => g.values.length > 0);
  if (groups.length < 2) invalid(`This test needs at least two groups with scores, but "${gname}" has ${groups.length}.`);
  const n = sum(groups.map((g) => g.values.length));
  return { outcome, gname, groups, n, excluded: nRows - n };
}

/** Classical one-way ANOVA sums of squares (Type I = II = III for a single factor). */
function classicF(xs: number[][]): { ssB: number; ssW: number; df1: number; df2: number; msB: number; msW: number | null; F: number | null; p: number | null } {
  const ns = xs.map((x) => x.length);
  const means = xs.map(mean);
  const N = sum(ns);
  const grand = sum(xs.map((_, i) => ns[i] * means[i])) / N;
  const ssB = sum(xs.map((_, i) => ns[i] * (means[i] - grand) ** 2));
  const ssW = sum(xs.map((x) => sum(x.map((v) => (v - mean(x)) ** 2))));
  const df1 = xs.length - 1;
  const df2 = N - xs.length;
  let F: number | null = null;
  let p: number | null = null;
  if (df2 > 0 && ssW > 0) {
    F = ssB / df1 / (ssW / df2);
    p = pF(F, df1, df2);
  }
  return { ssB, ssW, df1, df2, msB: ssB / df1, msW: df2 > 0 ? ssW / df2 : null, F, p };
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

// --- paired data (wide: two columns; long: outcome + time + subject_id on a linked/stacked dataset) ---------

type PairedData = {
  x: number[];
  y: number[];
  names: [string, string];
  groups: [Record<string, string>, Record<string, string>];
  outcomeLabel: string;
  nExcluded: number;
  notes: string[];
};

function numericColumnAligned(meta: DatasetMeta, cell: Cell, nRows: number, name: string): number[] {
  const v = meta.variables.find((x) => x.name === name);
  const missing = new Set((v?.missing_codes ?? []).map((m) => String(m)));
  const out: number[] = new Array(nRows);
  for (let r = 0; r < nRows; r++) {
    const raw = cell(r, name);
    if (raw === null || raw === "" || missing.has(String(raw))) {
      out[r] = NaN;
      continue;
    }
    const x = Number(raw);
    out[r] = Number.isFinite(x) ? x : NaN;
  }
  return out;
}

function normalizeIdCell(raw: CellValue, trim: boolean, caseInsensitive: boolean): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw);
  if (trim) s = s.trim();
  if (caseInsensitive) s = s.toLowerCase();
  return s === "" ? null : s;
}

function pairedWide(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): PairedData {
  const [a, c] = req.variables.measures;
  const xa = numericColumnAligned(meta, cell, nRows, a);
  const xb = numericColumnAligned(meta, cell, nRows, c);
  const x: number[] = [];
  const y: number[] = [];
  let n = 0;
  for (let r = 0; r < nRows; r++) {
    if (Number.isFinite(xa[r]) && Number.isFinite(xb[r])) {
      x.push(xa[r]);
      y.push(xb[r]);
      n++;
    }
  }
  const dropped = nRows - n;
  return {
    x,
    y,
    names: [a, c],
    groups: [{}, {}],
    outcomeLabel: `${a} and ${c}`,
    nExcluded: dropped,
    notes: dropped ? [`${dropped} people were left out because they are missing ${a} or ${c}`] : [],
  };
}

/** Mirrors the real engine's t_test.paired "long" layout (outcome + time + subject_id on a linked
 * dataset): pairs rows by normalized ID across exactly two time levels. The real engine (SPEC §8,
 * ttests.py `_paired_long`) always exposes this layout; only the mock catalog was missing it. */
function pairedLong(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): PairedData {
  const outcome = req.variables.outcome[0];
  const tname = req.variables.time[0];
  const sname = req.variables.subject_id[0];
  const y = numericColumnAligned(meta, cell, nRows, outcome);
  const tv = meta.variables.find((v) => v.name === tname);
  const orderPref = [...(tv?.value_labels.map((l) => String(l.value)) ?? []), ...(meta.stacking?.time_variable === tname ? meta.stacking.levels.map((l) => l.label) : [])];
  const present: string[] = [];
  const seen = new Set<string>();
  for (let r = 0; r < nRows; r++) {
    const tRaw = cell(r, tname);
    if (tRaw === null || tRaw === "") continue;
    const key = String(tRaw);
    if (!seen.has(key)) {
      seen.add(key);
      present.push(key);
    }
  }
  const rawLevels = req.options?.levels as string[] | undefined;
  let levels: string[];
  if (Array.isArray(rawLevels) && rawLevels.length >= 2) {
    levels = rawLevels.slice(0, 2);
  } else {
    if (present.length !== 2) invalid(`A paired comparison compares exactly two time points, but "${tname}" has ${present.length}. Filter to two or choose them in the options.`);
    levels = [...present].sort((p, q) => {
      const ip = orderPref.indexOf(p);
      const iq = orderPref.indexOf(q);
      return (ip < 0 ? 1e9 : ip) - (iq < 0 ? 1e9 : iq) || p.localeCompare(q);
    });
  }
  const link = meta.link;
  const norm = link && link.mode === "linked" && link.id_variable === sname && link.normalization ? link.normalization : { trim_whitespace: true, case_insensitive: false };
  const atLevel: [Map<string, number[]>, Map<string, number[]>] = [new Map(), new Map()];
  let noId = 0;
  let inLevels = 0;
  for (let r = 0; r < nRows; r++) {
    const tRaw = cell(r, tname);
    if (tRaw === null || tRaw === "") continue;
    const idx = levels.indexOf(String(tRaw));
    if (idx < 0) continue;
    inLevels++;
    const id = normalizeIdCell(cell(r, sname), norm.trim_whitespace, norm.case_insensitive);
    if (id === null) {
      noId++;
      continue;
    }
    const list = atLevel[idx].get(id) ?? [];
    list.push(y[r]);
    atLevel[idx].set(id, list);
  }
  const ids = new Set([...atLevel[0].keys(), ...atLevel[1].keys()]);
  const x: number[] = [];
  const yOut: number[] = [];
  let dup = 0;
  let oneSide = 0;
  let missingScore = 0;
  for (const id of ids) {
    const l0 = atLevel[0].get(id);
    const l1 = atLevel[1].get(id);
    if ((l0 && l0.length > 1) || (l1 && l1.length > 1)) {
      dup++;
      continue;
    }
    if (!l0 || !l1) {
      oneSide++;
      continue;
    }
    const [v0] = l0;
    const [v1] = l1;
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) {
      missingScore++;
      continue;
    }
    x.push(v0);
    yOut.push(v1);
  }
  const notes: string[] = [];
  if (oneSide) notes.push(`${oneSide} people have a score at only one of the two time points`);
  if (dup) notes.push(`${dup} IDs appear more than once at the same time point, so their scores can't be paired`);
  if (missingScore) notes.push(`${missingScore} matched people are missing a ${outcome} score`);
  if (noId) notes.push(`${noId} rows have no ID`);
  const n = x.length;
  return {
    x,
    y: yOut,
    names: [levels[0], levels[1]],
    groups: [{ [tname]: levels[0] }, { [tname]: levels[1] }],
    outcomeLabel: outcome,
    nExcluded: inLevels - 2 * n,
    notes,
  };
}

function pairedData(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): PairedData {
  return "measures" in req.variables ? pairedWide(req, meta, cell, nRows) : pairedLong(req, meta, cell, nRows);
}

function pairedTable(title: string, names: [string, string], d1: GroupDescriptives, d2: GroupDescriptives, t: number | null, df: number, p: number | null, es: number | null): ApaTable {
  return {
    number: 1,
    title,
    columns: columns(["Variable", "M", "SD", "M", "SD", "t", "df", "p", "d_av"]),
    column_groups: [
      { label: [R(names[0])], first_column: 1, span: 2 },
      { label: [R(names[1])], first_column: 3, span: 2 },
    ],
    rows: [
      {
        cells: [textCell(`${names[0]} - ${names[1]}`), numCell(d1.mean), numCell(d1.sd), numCell(d2.mean), numCell(d2.sd), numCell(t), numCell(df, dfText(df)), t === null ? { type: "p_value", value: null, display: "—" } : { type: "p_value", value: p, display: fmtP(p) }, numCell(es)],
        indent: 0,
        kind: "data",
      },
    ],
    notes: { general: [R("Paired-samples "), R("t", true), R(" test; "), R("d_av", true), R(" = Cohen's d")], specific: [], probability: [] },
  };
}

function pairedT(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): AnalysisResult {
  const out = baseResult(req, meta);
  const data = pairedData(req, meta, cell, nRows);
  const { x, y, names, groups, outcomeLabel, nExcluded, notes } = data;
  const n = x.length;
  if (n < 2) invalid(`A paired t test needs at least 2 people with both scores; there are ${n}.`);
  const diffs = x.map((v, i) => v - y[i]);
  const dlabel = `${names[0]} - ${names[1]}`;
  const constant = Math.max(...diffs) === Math.min(...diffs);
  const md = mean(diffs);
  const sdDiff = constant ? 0 : Math.sqrt(variance(diffs));
  let t: number | null = null;
  let p: number | null = null;
  let se = 0;
  if (!constant) {
    se = sdDiff / Math.sqrt(n);
    t = md / se;
    p = pT(t, n - 1);
  }
  out.statistics = [{ key: "t", label: "Paired t", symbol: "t", value: t, df: t !== null ? [n - 1] : [], p, term: null }];
  const dz = sdDiff > 0 ? md / sdDiff : null;
  const sdAvg = (Math.sqrt(variance(x)) + Math.sqrt(variance(y))) / 2;
  const dav = sdAvg > 0 ? md / sdAvg : null;
  const seD = (d: number) => Math.sqrt(1 / n + (d * d) / (2 * n));
  const tq = qt(0.05, n - 1);
  out.effect_sizes = [
    dav !== null
      ? { key: "d_av", label: "Cohen's d_av", symbol: "d_av", value: dav, ci: { level: 0.95, lower: dav - 1.96 * seD(dav), upper: dav + 1.96 * seD(dav) }, term: null, interpretation: magnitude(dav, "d") }
      : { key: "d_av", label: "Cohen's d_av", symbol: "d_av", value: null, ci: null, term: null, interpretation: null },
    dz !== null
      ? { key: "d_z", label: "Cohen's d_z", symbol: "d_z", value: dz, ci: { level: 0.95, lower: dz - 1.96 * seD(dz), upper: dz + 1.96 * seD(dz) }, term: null, interpretation: magnitude(dz, "d") }
      : { key: "d_z", label: "Cohen's d_z", symbol: "d_z", value: null, ci: null, term: null, interpretation: null },
    { key: "mean_difference", label: "Mean difference", symbol: "Mdiff", value: md, ci: { level: 0.95, lower: md - tq * (sdDiff / Math.sqrt(n)), upper: md + tq * (sdDiff / Math.sqrt(n)) }, term: null, interpretation: null },
  ];
  const d1 = describe(outcomeLabel, groups[0], names[0], x, 0);
  const d2 = describe(outcomeLabel, groups[1], names[1], y, 0);
  out.descriptives.continuous = [d1, d2];
  out.assumptions = [normalityCheck(diffs, "differences", { kind: "differences", label: dlabel, group: null, n }, "diff", out.chart_data as never)];
  if (n < 20) out.warnings.push({ code: "small_sample", severity: "caution", message: `Only ${n} people have both scores; results may be less stable.` });
  if (notes.length) out.warnings.push({ code: "pairs_dropped", severity: "info", message: `Paired tests need the same person at both times, so some people were left out: ${notes.join("; ")}. ${n} complete pairs were analysed.` });
  out.inputs = { ...out.inputs, n_used: n, n_excluded: nExcluded, n_by_group: groups[0] && Object.keys(groups[0]).length ? [{ group: groups[0], n }, { group: groups[1], n }] : [] };
  const sig = t !== null && p !== null && p < req.alpha;
  if (constant) {
    out.plain_language_summary = `Every difference (${dlabel}) was the same, so a paired t test could not be computed.`;
    out.apa_sentence = [R(`A paired-samples `), R("t", true), R(` test could not be computed because every difference (${dlabel}) was the same.`)];
  } else {
    out.plain_language_summary = `For the ${n} people with both scores, scores were ${t! > 0 ? "higher" : "lower"} at ${names[0]} than at ${names[1]} on average (a difference of ${f2(Math.abs(md))} points). ${
      sig ? `This change is unlikely to be due to chance alone (p ${p! < 0.001 ? "< .001" : `= ${fmtP(p)}`}).` : `This change could easily be due to chance (p = ${fmtP(p)}).`
    }${dav !== null ? ` The size of the change was ${magnitude(dav, "d")!.magnitude} by common benchmarks.` : ""}`;
    out.apa_sentence = [
      R("A paired-samples "),
      R("t", true),
      R(` test showed that scores were ${sig ? "significantly" : "not significantly"} ${t! > 0 ? "higher" : "lower"} at ${names[0]} (`),
      R("M", true),
      R(` = ${f2(d1.mean)}, `),
      R("SD", true),
      R(` = ${f2(d1.sd)}) than at ${names[1]} (`),
      R("M", true),
      R(` = ${f2(d2.mean)}, `),
      R("SD", true),
      R(` = ${f2(d2.sd)}), `),
      R("t", true),
      R(`(${n - 1}) = ${f2(t)}, `),
      ...pRun(p!),
      ...(dav !== null ? [R(", "), R("d_av", true), R(` = ${f2(dav)}.`)] : [R(".")]),
    ];
  }
  out.apa_table = pairedTable(`Paired-Samples t Test of ${dlabel}`, names, d1, d2, t, n - 1, p, dav);
  return out;
}

// --- Wilcoxon signed-rank (normal approximation; the real engine uses R's exact conditional
// distribution when n < 50 - see nonparametric.py. This mock always uses the normal approximation,
// labelled as such, same convention as mannWhitney above.) ---------------------------------------

function wilcoxonSignedRank(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): AnalysisResult {
  const out = baseResult(req, meta);
  const data = pairedData(req, meta, cell, nRows);
  const { x, y, names, groups, outcomeLabel, nExcluded, notes } = data;
  const n = x.length;
  if (n < 1) invalid(`A Wilcoxon signed-rank test needs at least 1 person with both scores; there are 0.`);
  const diffs = x.map((v, i) => v - y[i]);
  const nz = diffs.map((d, i) => ({ d, i })).filter(({ d }) => d !== 0);
  const d1 = describe(outcomeLabel, groups[0], names[0], x, 0);
  const d2 = describe(outcomeLabel, groups[1], names[1], y, 0);
  out.descriptives.continuous = [d1, d2];
  let V: number | null = null;
  let z: number | null = null;
  let p: number | null = null;
  let rb: number | null = null;
  if (nz.length > 0) {
    const abs = nz.map(({ d }) => Math.abs(d));
    const { ranks, tieTerm } = rankWithTies(abs);
    V = sum(nz.map(({ d }, k) => (d > 0 ? ranks[k] : 0)));
    const m = nz.length;
    const mu = (m * (m + 1)) / 4;
    const sigma = Math.sqrt((m * (m + 1) * (2 * m + 1)) / 24 - tieTerm / 48);
    z = sigma > 0 ? (V - mu) / sigma : null;
    p = z !== null ? Math.min(1, 2 * (1 - normCdf(Math.abs(z)))) : null;
    rb = z !== null ? z / Math.sqrt(m) : null;
  } else {
    out.warnings.push({ code: "constant_variable", severity: "serious", message: "Every difference was zero, so a Wilcoxon signed-rank test can't be computed." });
  }
  out.statistics = [
    { key: "v", label: "Wilcoxon signed-rank V (normal approximation)", symbol: "V", value: V, df: [], p, term: null },
    { key: "z", label: "z (normal approximation, no continuity correction)", symbol: "z", value: z, df: [], p: null, term: null },
  ];
  out.effect_sizes = [rb !== null ? { key: "rank_biserial", label: "Matched-pairs rank-biserial correlation", symbol: "r", value: rb, ci: { level: 0.95, lower: Math.max(-1, rb - 0.25), upper: Math.min(1, rb + 0.25) }, term: null, interpretation: magnitude(rb, "r") } : { key: "rank_biserial", label: "Matched-pairs rank-biserial correlation", symbol: "r", value: null, ci: null, term: null, interpretation: null }];
  const zeros = diffs.length - nz.length;
  if (zeros) out.warnings.push({ code: "zero_differences", severity: "info", message: `${zeros} people had no difference (${names[0]} = ${names[1]}). They are left out of the ranking, as in R.` });
  if (n < 20) out.warnings.push({ code: "small_sample", severity: "caution", message: `Only ${n} people were analysed; results may be less stable.` });
  if (notes.length) out.warnings.push({ code: "pairs_dropped", severity: "info", message: `Wilcoxon signed-rank needs the same person at both times, so some people were left out: ${notes.join("; ")}. ${n} complete pairs were analysed.` });
  out.inputs = { ...out.inputs, n_used: n, n_excluded: nExcluded, n_by_group: groups[0] && Object.keys(groups[0]).length ? [{ group: groups[0], n }, { group: groups[1], n }] : [] };
  const med = (arr: number[]) => quantile([...arr].sort((a, b) => a - b), 0.5);
  if (p === null) {
    out.plain_language_summary = "Every person had the same score both times, so there is no change to test.";
    out.apa_sentence = [R("A Wilcoxon signed-rank test could not be computed because every difference was zero.")];
  } else {
    const sig = p < req.alpha;
    const up = (rb ?? 0) > 0;
    const [hi, lo] = up ? [names[0], names[1]] : [names[1], names[0]];
    out.plain_language_summary = `For the ${n} people with both scores, scores tended to be higher at ${hi} than at ${lo} (medians ${f2(med(x))} and ${f2(med(y))}). ${
      sig ? `This change is unlikely to be due to chance alone (p ${p < 0.001 ? "< .001" : `= ${fmtP(p)}`}).` : `This change could easily be due to chance (p = ${fmtP(p)}).`
    }`;
    out.apa_sentence = [
      R(`A Wilcoxon signed-rank test indicated that scores were ${sig ? "significantly" : "not significantly"} ${up ? "higher" : "lower"} at ${names[0]} (`),
      R("Mdn", true),
      R(` = ${f2(med(x))}) than at ${names[1]} (`),
      R("Mdn", true),
      R(` = ${f2(med(y))}), `),
      R("V", true),
      R(` = ${f2(V)}, `),
      ...pRun(p),
      ...(rb !== null ? [R(", "), R("r", true), R(` = ${noZero(rb.toFixed(2))}.`)] : [R(".")]),
    ];
  }
  out.apa_table = {
    number: 1,
    title: `Wilcoxon Signed-Rank Test of ${names[0]} and ${names[1]}`,
    columns: columns(["Variable", "Mdn", "Mdn", "V", "p", "r"]),
    column_groups: [
      { label: [R(names[0])], first_column: 1, span: 1 },
      { label: [R(names[1])], first_column: 2, span: 1 },
    ],
    rows: [{ cells: [textCell(outcomeLabel), numCell(med(x)), numCell(med(y)), numCell(V), p === null ? { type: "p_value", value: null, display: "—" } : { type: "p_value", value: p, display: fmtP(p) }, rb === null ? numCell(null) : numCell(rb, noZero(rb.toFixed(2)))], indent: 0, kind: "data" }],
    notes: { general: [R("Rank-biserial "), R("r", true), R(" is the effect size; normal approximation (mock engine).")], specific: [], probability: [] },
  };
  return out;
}

// --- One-way ANOVA -------------------------------------------------------------------------------

function oneWayAnovaRun(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): AnalysisResult {
  const out = baseResult(req, meta);
  const { outcome, gname, groups, n, excluded } = kGroups(req, meta, cell, nRows);
  const xs = groups.map((g) => g.values);
  const k = xs.length;
  const cf = classicF(xs);
  out.statistics = [{ key: "F", label: "F (equal variances assumed)", symbol: "F", value: cf.F, df: cf.F !== null ? [cf.df1, cf.df2] : [], p: cf.p, term: null }];
  const etaSq = cf.F !== null ? cf.ssB / (cf.ssB + cf.ssW) : null;
  const omegaSq = cf.F !== null && cf.msW !== null ? Math.max(0, (cf.ssB - cf.df1 * cf.msW) / (cf.ssB + cf.ssW + cf.msW)) : null;
  const cohensF = etaSq !== null && etaSq < 1 ? Math.sqrt(etaSq / (1 - etaSq)) : null;
  const seEta = etaSq !== null && cf.df2 > 0 ? Math.sqrt((etaSq * (1 - etaSq)) / cf.df2) : null;
  out.effect_sizes = [
    etaSq !== null ? { key: "eta_sq", label: "Eta squared", symbol: "η²", value: etaSq, ci: boundedCi(etaSq, seEta!), term: null, interpretation: magnitude(etaSq, "eta") } : { key: "eta_sq", label: "Eta squared", symbol: "η²", value: null, ci: null, term: null, interpretation: null },
    omegaSq !== null ? { key: "omega_sq", label: "Omega squared", symbol: "ω²", value: omegaSq, ci: boundedCi(omegaSq, seEta!), term: null, interpretation: magnitude(omegaSq, "eta") } : { key: "omega_sq", label: "Omega squared", symbol: "ω²", value: null, ci: null, term: null, interpretation: null },
    cohensF !== null ? { key: "cohens_f", label: "Cohen's f", symbol: "f", value: cohensF, ci: null, term: null, interpretation: magnitude(cohensF, "f") } : { key: "cohens_f", label: "Cohen's f", symbol: "f", value: null, ci: null, term: null, interpretation: null },
  ];
  const rows = groups.map((g) => describe(outcome, { [gname]: g.level }, g.level, g.values, 0));
  out.descriptives.continuous = rows;
  out.assumptions = groups.map((g) => normalityCheck(g.values, g.level, { kind: "group", label: g.level, group: { [gname]: g.level }, n: g.values.length }, slug(g.level), out.chart_data as never));
  const lev = leveneBF(xs);
  out.assumptions.push({
    schema_version: 1,
    assumption: "homogeneity_of_variance",
    label: "Equal spread (homogeneity of variance)",
    test_used: { key: "levene_brown_forsythe", label: "Levene's test (Brown-Forsythe)" },
    statistic: { symbol: "F", value: lev.F, df: [lev.df1, lev.df2] },
    p: lev.p,
    verdict: lev.p < req.alpha ? "failed" : "passed",
    explanation: lev.p < req.alpha ? `The groups' scores are spread out by different amounts (p = ${fmtP(lev.p)}).` : `The groups' scores are spread out by similar amounts (p = ${fmtP(lev.p)}), so this assumption looks reasonable.`,
    applies_to: { kind: "overall", label: "all groups", group: null, n },
    chart_refs: [],
  });
  if (Object.values(groups).some((g) => g.values.length < 20)) out.warnings.push({ code: "small_sample", severity: "caution", message: "At least one group has fewer than 20 people, so results may be unstable." });
  out.inputs = { ...out.inputs, n_used: n, n_excluded: excluded, n_by_group: groups.map((g) => ({ group: { [gname]: g.level }, n: g.values.length })) };
  if (cf.F === null) {
    out.plain_language_summary = `A one-way ANOVA could not be computed because ${outcome} scores do not vary within the groups.`;
    out.apa_sentence = [R("A one-way ANOVA could not be computed for "), R(outcome), R(` across the groups of ${gname}.`)];
  } else {
    const sig = cf.p! < req.alpha;
    out.plain_language_summary = `Average ${outcome} scores were compared across the ${k} groups of ${gname}. ${
      sig ? "Differences this large are unlikely to be due to chance alone" : "The differences could easily be due to chance, so there is no strong evidence that the groups really differ"
    } (p ${cf.p! < 0.001 ? "< .001" : `= ${fmtP(cf.p)}`}).${etaSq !== null ? ` The size of the effect was ${magnitude(etaSq, "eta")!.magnitude} by common benchmarks.` : ""}${sig && k > 2 ? " A post hoc test shows which groups differ." : ""}`;
    out.apa_sentence = [
      R("A one-way ANOVA showed that "),
      R(outcome),
      R(` scores ${sig ? "differed significantly" : "did not differ significantly"} across the ${k} groups of ${gname}, `),
      R("F", true),
      R(`(${cf.df1}, ${cf.df2}) = ${f2(cf.F)}, `),
      ...pRun(cf.p!),
      ...(etaSq !== null ? [R(", "), R("η²", true), R(` = ${noZero(etaSq.toFixed(2))}.`)] : [R(".")]),
    ];
  }
  out.apa_table = {
    number: 1,
    title: `One-Way ANOVA of ${outcome} by ${gname}`,
    columns: columns(["Source", "SS", "df", "MS", "F", "p", "η²"]),
    column_groups: [],
    rows: [
      { cells: [textCell(gname), numCell(cf.ssB), numCell(cf.df1, String(cf.df1)), numCell(cf.msB), numCell(cf.F), cf.p === null ? { type: "p_value", value: null, display: "—" } : { type: "p_value", value: cf.p, display: fmtP(cf.p) }, numCell(etaSq)], indent: 0, kind: "data" },
      { cells: [textCell("Within groups"), numCell(cf.ssW), numCell(cf.df2, String(cf.df2)), numCell(cf.msW), numCell(null), { type: "p_value", value: null, display: "" }, numCell(null)], indent: 0, kind: "data" },
    ],
    notes: { general: [R("Type III sums of squares (equivalent to Type I for one factor). "), R("η²", true), R(" = eta squared.")], specific: [], probability: [] },
  };
  return out;
}

// --- Mixed ANOVA (between x within) -----------------------------------------------------------
// Mock approximation: classic univariate mixed-design sums of squares (assumes sphericity),
// not the MANOVA-based approach the real engine uses. Supports both layouts: wide ("measures" +
// "between") and long ("outcome" + "time" + "subject_id" + "between", pairing rows by normalized
// subject id, mirroring pairedLong).

/** Wide layout ("measures" + "between"): one row per subject already. */
function mixedWideSubjects(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number, gname: string): { subjects: { g: string; y: number[] }[]; timeLabels: string[] } {
  const cols = req.variables.measures;
  if (!cols || cols.length < 2) invalid("Mixed ANOVA needs two or more time-point columns.");
  if (new Set(cols).size !== cols.length) invalid("Each measure can be chosen only once.");
  if (cols.includes(gname)) invalid("The grouping variable can't also be one of the measures.");
  const subjects: { g: string; y: number[] }[] = [];
  for (let r = 0; r < nRows; r++) {
    const g = cell(r, gname);
    if (g === null || g === "") continue;
    const y: number[] = [];
    let ok = true;
    for (const c of cols) {
      const raw = cell(r, c);
      if (raw === null || raw === "") { ok = false; break; }
      const x = Number(raw);
      if (!Number.isFinite(x)) { ok = false; break; }
      y.push(x);
    }
    if (ok) subjects.push({ g: String(g), y });
  }
  return { subjects, timeLabels: cols.map((c) => prep_label(meta, c)) };
}

function prep_label(meta: DatasetMeta, name: string): string {
  const v = meta.variables.find((x) => x.name === name);
  return v?.label && v.label !== name ? v.label : name;
}

/** Long layout (outcome + time + subject_id + between, on a linked/stacked dataset): pairs rows by
 * normalized subject id across every time level present. Mirrors pairedLong's id matching. */
function mixedLongSubjects(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number, gname: string): { subjects: { g: string; y: number[] }[]; timeLabels: string[] } {
  const outcome = req.variables.outcome?.[0];
  const tname = req.variables.time?.[0];
  const sname = req.variables.subject_id?.[0];
  if (!outcome || !tname || !sname) invalid("Mixed ANOVA needs measures (wide layout) or outcome/time/subject_id (long layout).");
  const tv = meta.variables.find((x) => x.name === tname);
  const orderPref = [...(tv?.value_labels.map((l) => String(l.value)) ?? []), ...(meta.stacking?.time_variable === tname ? meta.stacking.levels.map((l) => l.label) : [])];
  const seen = new Set<string>();
  for (let r = 0; r < nRows; r++) {
    const tRaw = cell(r, tname);
    if (tRaw !== null && tRaw !== "") seen.add(String(tRaw));
  }
  const timeLabels = [...seen].sort((a, b) => {
    const ia = orderPref.indexOf(a);
    const ib = orderPref.indexOf(b);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.localeCompare(b);
  });
  const link = meta.link;
  const norm = link && link.mode === "linked" && link.id_variable === sname && link.normalization ? link.normalization : { trim_whitespace: true, case_insensitive: false };
  const bySubject = new Map<string, { g: string; vals: Map<string, number[]> }>();
  for (let r = 0; r < nRows; r++) {
    const tRaw = cell(r, tname);
    if (tRaw === null || tRaw === "") continue;
    const t = String(tRaw);
    const g = cell(r, gname);
    const yRaw = cell(r, outcome);
    if (g === null || g === "" || yRaw === null || yRaw === "") continue;
    const y = Number(yRaw);
    if (!Number.isFinite(y)) continue;
    const id = normalizeIdCell(cell(r, sname), norm.trim_whitespace, norm.case_insensitive);
    if (id === null) continue;
    if (!bySubject.has(id)) bySubject.set(id, { g: String(g), vals: new Map() });
    const rec = bySubject.get(id)!;
    const list = rec.vals.get(t) ?? [];
    list.push(y);
    rec.vals.set(t, list);
  }
  const subjects: { g: string; y: number[] }[] = [];
  for (const rec of bySubject.values()) {
    if (timeLabels.every((t) => rec.vals.get(t)?.length === 1)) subjects.push({ g: rec.g, y: timeLabels.map((t) => rec.vals.get(t)![0]) });
  }
  return { subjects, timeLabels };
}

function mixedAnovaRun(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): AnalysisResult {
  const out = baseResult(req, meta);
  const gname = req.variables.between?.[0];
  if (!gname) invalid("Mixed ANOVA needs a between-subjects grouping variable.");
  const { subjects, timeLabels } = "measures" in req.variables ? mixedWideSubjects(req, meta, cell, nRows, gname) : mixedLongSubjects(req, meta, cell, nRows, gname);
  const k = timeLabels.length;
  if (k < 2) invalid("Mixed ANOVA needs two or more time points.");
  const excluded = nRows - subjects.length;

  const v = meta.variables.find((x) => x.name === gname);
  const order = v?.value_labels.map((l) => String(l.value)) ?? [];
  const levels = [...new Set(subjects.map((s) => s.g))].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.localeCompare(b);
  });
  if (levels.length < 2) invalid(`Mixed ANOVA needs at least two groups, but "${gname}" has ${levels.length}.`);
  const groupSubjects = levels.map((lv) => subjects.filter((s) => s.g === lv));
  if (groupSubjects.some((gs) => gs.length < 2)) invalid("Each group needs at least two people.");

  const G = levels.length;
  const N = subjects.length;
  const allY = subjects.flatMap((s) => s.y);
  const grand = mean(allY);

  const subjMean = (s: { y: number[] }) => mean(s.y);
  const ssBetweenSubj = k * sum(subjects.map((s) => (subjMean(s) - grand) ** 2));
  const ssTotal = sum(subjects.flatMap((s) => s.y.map((yv) => (yv - grand) ** 2)));
  const ssWithinSubj = ssTotal - ssBetweenSubj;

  const groupMean = (gs: { y: number[] }[]) => mean(gs.flatMap((s) => s.y));
  const groupMeans = groupSubjects.map(groupMean);
  const ssA = k * sum(groupSubjects.map((gs, i) => gs.length * (groupMeans[i] - grand) ** 2));
  const ssSA = ssBetweenSubj - ssA;

  const timeMean = (t: number) => mean(subjects.map((s) => s.y[t]));
  const timeMeans = timeLabels.map((_, t) => timeMean(t));
  const ssB = N * sum(timeMeans.map((m) => (m - grand) ** 2));

  const cellMean = (gs: { y: number[] }[], t: number) => mean(gs.map((s) => s.y[t]));
  const ssAB = sum(
    groupSubjects.flatMap((gs, gi) => timeLabels.map((_, t) => gs.length * (cellMean(gs, t) - groupMeans[gi] - timeMeans[t] + grand) ** 2)),
  );
  const ssErr = ssWithinSubj - ssB - ssAB;

  const dfA = G - 1;
  const dfSA = N - G;
  const dfB = k - 1;
  const dfAB = (G - 1) * (k - 1);
  const dfErr = (N - G) * (k - 1);

  const msA = ssA / dfA;
  const msSA = dfSA > 0 ? ssSA / dfSA : null;
  const msB = ssB / dfB;
  const msAB = ssAB / dfAB;
  const msErr = dfErr > 0 ? ssErr / dfErr : null;

  const FA = msSA ? msA / msSA : null;
  const FB = msErr ? msB / msErr : null;
  const FAB = msErr ? msAB / msErr : null;
  const pA = FA !== null ? pF(FA, dfA, dfSA) : null;
  const pB = FB !== null ? pF(FB, dfB, dfErr) : null;
  const pAB = FAB !== null ? pF(FAB, dfAB, dfErr) : null;

  const etaA = FA !== null ? ssA / (ssA + ssSA) : null;
  const etaB = FB !== null ? ssB / (ssB + ssErr) : null;
  const etaAB = FAB !== null ? ssAB / (ssAB + ssErr) : null;

  out.statistics = [
    { key: "F_between", label: `F (${gname})`, symbol: "F", value: FA, df: FA !== null ? [dfA, dfSA] : [], p: pA, term: gname },
    { key: "F_within", label: "F (time)", symbol: "F", value: FB, df: FB !== null ? [dfB, dfErr] : [], p: pB, term: "time" },
    { key: "F_interaction", label: `F (${gname} x time)`, symbol: "F", value: FAB, df: FAB !== null ? [dfAB, dfErr] : [], p: pAB, term: `${gname}:time` },
  ];
  out.effect_sizes = [
    { key: "partial_eta_sq_between", label: "Partial eta squared (group)", symbol: "η²p", value: etaA, ci: etaA !== null ? boundedCi(etaA, Math.sqrt((etaA * (1 - etaA)) / Math.max(1, dfSA))) : null, term: gname, interpretation: etaA !== null ? magnitude(etaA, "eta") : null },
    { key: "partial_eta_sq_within", label: "Partial eta squared (time)", symbol: "η²p", value: etaB, ci: etaB !== null ? boundedCi(etaB, Math.sqrt((etaB * (1 - etaB)) / Math.max(1, dfErr))) : null, term: "time", interpretation: etaB !== null ? magnitude(etaB, "eta") : null },
    { key: "partial_eta_sq_interaction", label: "Partial eta squared (interaction)", symbol: "η²p", value: etaAB, ci: etaAB !== null ? boundedCi(etaAB, Math.sqrt((etaAB * (1 - etaAB)) / Math.max(1, dfErr))) : null, term: `${gname}:time`, interpretation: etaAB !== null ? magnitude(etaAB, "eta") : null },
  ];

  out.descriptives.continuous = levels.flatMap((lv, gi) =>
    timeLabels.map((c, t) => describe(c, { [gname]: lv }, `${lv}, ${c}`, groupSubjects[gi].map((s) => s.y[t]), 0)),
  );

  out.inputs = { ...out.inputs, n_used: N, n_excluded: excluded, n_by_group: levels.map((lv, gi) => ({ group: { [gname]: lv }, n: groupSubjects[gi].length })) };
  if (levels.some((_, gi) => groupSubjects[gi].length < 20)) out.warnings.push({ code: "small_sample", severity: "caution", message: "At least one group has fewer than 20 people, so results may be unstable." });

  if (FAB === null) {
    out.plain_language_summary = `A mixed ANOVA could not be computed because ${timeLabels.join(", ")} did not vary enough within the groups of ${gname}.`;
    out.apa_sentence = [R("A mixed ANOVA could not be computed for "), R(timeLabels.join(", ")), R(` across the groups of ${gname}.`)];
  } else {
    const sigAB = pAB! < req.alpha;
    out.plain_language_summary = `Scores on ${timeLabels.join(", ")} were compared across the ${G} groups of ${gname} over ${k} time points. ${
      sigAB ? `The groups changed differently over time (a significant ${gname} x time interaction)` : "The groups changed similarly over time (no significant interaction)"
    } (p ${pAB! < 0.001 ? "< .001" : `= ${fmtP(pAB!)}`}).`;
    out.apa_sentence = [
      R("A mixed ANOVA showed a "),
      R(`${sigAB ? "significant" : "non-significant"} ${gname} x time interaction, `),
      R("F", true),
      R(`(${dfAB}, ${dfErr}) = ${f2(FAB)}, `),
      ...pRun(pAB!),
      ...(etaAB !== null ? [R(", "), R("η²p", true), R(` = ${noZero(etaAB.toFixed(2))}.`)] : [R(".")]),
    ];
  }

  out.apa_table = {
    number: 1,
    title: `Mixed ANOVA of ${timeLabels.join(", ")} by ${gname} x time`,
    columns: columns(["Source", "SS", "df", "MS", "F", "p", "η²p"]),
    column_groups: [],
    rows: [
      { cells: [textCell(gname), numCell(ssA), numCell(dfA, String(dfA)), numCell(msA), numCell(FA), pA === null ? { type: "p_value", value: null, display: "—" } : { type: "p_value", value: pA, display: fmtP(pA) }, numCell(etaA)], indent: 0, kind: "data" },
      { cells: [textCell(`Error (${gname})`), numCell(ssSA), numCell(dfSA, String(dfSA)), numCell(msSA), numCell(null), { type: "p_value", value: null, display: "" }, numCell(null)], indent: 0, kind: "data" },
      { cells: [textCell("Time"), numCell(ssB), numCell(dfB, String(dfB)), numCell(msB), numCell(FB), pB === null ? { type: "p_value", value: null, display: "—" } : { type: "p_value", value: pB, display: fmtP(pB) }, numCell(etaB)], indent: 0, kind: "data" },
      { cells: [textCell(`${gname} x time`), numCell(ssAB), numCell(dfAB, String(dfAB)), numCell(msAB), numCell(FAB), pAB === null ? { type: "p_value", value: null, display: "—" } : { type: "p_value", value: pAB, display: fmtP(pAB) }, numCell(etaAB)], indent: 0, kind: "data" },
      { cells: [textCell("Error (within)"), numCell(ssErr), numCell(dfErr, String(dfErr)), numCell(msErr), numCell(null), { type: "p_value", value: null, display: "" }, numCell(null)], indent: 0, kind: "data" },
    ],
    notes: { general: [R("Mock approximation: classic univariate mixed-design sums of squares (assumes sphericity). "), R("η²p", true), R(" = partial eta squared.")], specific: [], probability: [] },
  };
  return out;
}

// --- Kruskal-Wallis --------------------------------------------------------------------------------

function kruskalWallisRun(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): AnalysisResult {
  const out = baseResult(req, meta);
  const { outcome, gname, groups, n, excluded } = kGroups(req, meta, cell, nRows);
  const xs = groups.map((g) => g.values);
  const k = xs.length;
  const values = xs.flat();
  const codes = xs.flatMap((x, i) => x.map(() => i));
  const constant = new Set(values).size <= 1;
  let H: number | null = null;
  let p: number | null = null;
  const mean_ranks: number[] = new Array(k).fill(0);
  if (!constant) {
    const { ranks, tieTerm } = rankWithTies(values);
    const N = values.length;
    const Ri = new Array(k).fill(0);
    for (let i = 0; i < values.length; i++) Ri[codes[i]] += ranks[i];
    const Hraw = (12 / (N * (N + 1))) * sum(Ri.map((r, i) => (r * r) / xs[i].length)) - 3 * (N + 1);
    const C = 1 - tieTerm / (N ** 3 - N);
    H = C > 0 ? Hraw / C : Hraw;
    p = chi2Sf(H, k - 1);
    for (let i = 0; i < k; i++) mean_ranks[i] = Ri[i] / xs[i].length;
  }
  out.descriptives.continuous = groups.map((g) => describe(outcome, { [gname]: g.level }, g.level, g.values, 0));
  if (constant) out.warnings.push({ code: "constant_variable", severity: "serious", message: `Every ${outcome} score was the same, so a Kruskal-Wallis test can't be computed.` });
  out.statistics = [{ key: "h", label: "Kruskal-Wallis H (chi-square approximation)", symbol: "H", value: H, df: H !== null ? [k - 1] : [], p, term: null }];
  const N = values.length;
  const epsSq = H !== null && N > 1 ? Math.max(0, H / (N - 1)) : null;
  const seEps = epsSq !== null ? Math.sqrt((epsSq * (1 - epsSq)) / Math.max(1, k - 1)) : null;
  out.effect_sizes = [epsSq !== null ? { key: "epsilon_sq", label: "Rank epsilon squared", symbol: "ε²", value: epsSq, ci: boundedCi(epsSq, seEps!), term: null, interpretation: magnitude(epsSq, "eta") } : { key: "epsilon_sq", label: "Rank epsilon squared", symbol: "ε²", value: null, ci: null, term: null, interpretation: null }];
  if (groups.some((g) => g.values.length < 5)) out.warnings.push({ code: "chi_square_approximation", severity: "caution", message: "Some groups have fewer than 5 scores, so the chi-square p-value of the Kruskal-Wallis test is only approximate." });
  out.inputs = { ...out.inputs, n_used: n, n_excluded: excluded, n_by_group: groups.map((g) => ({ group: { [gname]: g.level }, n: g.values.length })) };
  if (H === null) {
    out.plain_language_summary = `Every ${outcome} score was the same, so the groups can't be compared.`;
    out.apa_sentence = [R("A Kruskal-Wallis test could not be computed because every score was the same.")];
  } else {
    const sig = p! < req.alpha;
    const top = groups[mean_ranks.indexOf(Math.max(...mean_ranks))].level;
    const low = groups[mean_ranks.indexOf(Math.min(...mean_ranks))].level;
    out.plain_language_summary = `Scores tended to be highest in the ${top} group and lowest in the ${low} group. ${
      sig ? `Differences this large are unlikely to be due to chance alone (p ${p! < 0.001 ? "< .001" : `= ${fmtP(p)}`}); a follow-up test shows which groups differ.` : `These differences could easily be due to chance (p = ${fmtP(p)}).`
    }`;
    out.apa_sentence = [
      R(`A Kruskal-Wallis test showed ${sig ? "a significant" : "no significant"} difference in ${outcome} scores across the ${k} groups of ${gname}, `),
      R("H", true),
      R(`(${k - 1}) = ${f2(H)}, `),
      ...pRun(p!),
      ...(epsSq !== null ? [R(", "), R("ε²", true), R(` = ${noZero(epsSq.toFixed(2))}.`)] : [R(".")]),
    ];
  }
  out.apa_table = {
    number: 1,
    title: `${outcome} by ${gname}: Kruskal-Wallis Test`,
    columns: columns(["Group", "n", "Mean rank"]),
    column_groups: [],
    rows: groups.map((g, i) => ({ cells: [textCell(g.level), numCell(g.values.length, String(g.values.length)), numCell(mean_ranks[i])], indent: 0, kind: "data" as const })),
    notes: { general: H !== null ? [R("H", true), R(`(${k - 1}) = ${f2(H)}, `), R("p", true), R(` ${fmtP(p)}. `), R("ε²", true), R(" = rank epsilon squared.")] : null, specific: [], probability: [] },
  };
  return out;
}

// --- Tukey HSD post hoc (approximated in the mock as Holm-adjusted pairwise Student's t on the
// one-way ANOVA's pooled MSE, rather than the real engine's studentized-range distribution - see
// posthoc_param.py. Direction and roles otherwise mirror the real engine exactly.) ----------------

function holmAdjust(p: (number | null)[]): (number | null)[] {
  const idx = p.map((_, i) => i).filter((i) => p[i] !== null);
  const out: (number | null)[] = new Array(p.length).fill(null);
  let running = 0;
  const sorted = [...idx].sort((a, b) => p[a]! - p[b]!);
  const m = idx.length;
  sorted.forEach((i, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p[i]!));
    out[i] = running;
  });
  return out;
}

function tukeyPosthoc(req: AnalysisRequest, meta: DatasetMeta, cell: Cell, nRows: number): AnalysisResult {
  const out = baseResult(req, meta);
  const { outcome, gname, groups, n, excluded } = kGroups(req, meta, cell, nRows);
  const xs = groups.map((g) => g.values);
  const k = xs.length;
  const cf = classicF(xs);
  const mse = cf.msW;
  const dfE = cf.df2;
  const pairs: [number, number][] = [];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j]);
  const raw = pairs.map(([i, j]) => {
    const ni = xs[i].length;
    const nj = xs[j].length;
    const diff = mean(xs[i]) - mean(xs[j]);
    const se = mse && dfE > 0 ? Math.sqrt(mse * (1 / ni + 1 / nj)) : null;
    const t = se && se > 0 ? diff / se : null;
    const p = t !== null && dfE > 0 ? pT(Math.abs(t), dfE) : null;
    return { i, j, diff, se, t, p };
  });
  const adjP = holmAdjust(raw.map((r) => r.p));
  const m = pairs.length;
  const level = 0.95;
  const tq = dfE > 0 ? qt((1 - level) / m, dfE) : null;
  out.descriptives.continuous = groups.map((g) => describe(outcome, { [gname]: g.level }, g.level, g.values, 0));
  const rowsOut = raw.map((r, idx) => {
    const a = groups[r.i];
    const b = groups[r.j];
    const term = `${a.level} vs ${b.level}`;
    const pAdj = adjP[idx];
    const half = tq !== null && r.se !== null ? tq * r.se : null;
    const sp = Math.sqrt(((a.values.length - 1) * variance(a.values) + (b.values.length - 1) * variance(b.values)) / (a.values.length + b.values.length - 2));
    const g = sp > 0 ? r.diff / sp : null;
    out.statistics.push({ key: "t", label: "t (pairwise comparison, Holm-adjusted)", symbol: "t", value: r.t, df: r.t !== null ? [dfE] : [], p: pAdj, term });
    out.effect_sizes.push({ key: "mean_difference", label: "Mean difference", symbol: "Mdiff", value: r.diff, ci: half !== null ? { level, lower: r.diff - half, upper: r.diff + half } : null, term, interpretation: null });
    out.effect_sizes.push(g !== null ? { key: "hedges_g", label: "Hedges' g", symbol: "g", value: g, ci: null, term, interpretation: magnitude(g, "d") } : { key: "hedges_g", label: "Hedges' g", symbol: "g", value: null, ci: null, term, interpretation: null });
    return { term, a, b, diff: r.diff, t: r.t, p: pAdj, g, half };
  });
  const sig = rowsOut.filter((r) => r.p !== null && r.p < req.alpha);
  out.inputs = { ...out.inputs, n_used: n, n_excluded: excluded, n_by_group: groups.map((g) => ({ group: { [gname]: g.level }, n: g.values.length })) };
  if (!sig.length) {
    out.plain_language_summary = `None of the ${rowsOut.length} pairs differed clearly once the number of comparisons is taken into account (all adjusted p's ≥ ${req.alpha}).`;
    out.apa_sentence = [R(`Tukey HSD comparisons of ${outcome} found no significant pairwise differences (all Holm-adjusted `), R("p", true), R(`s ≥ ${req.alpha}).`)];
  } else {
    const parts = sig.map((r) => {
      const [hi, lo] = r.diff > 0 ? [r.a.level, r.b.level] : [r.b.level, r.a.level];
      return `${hi} scored higher than ${lo} (${p_phrase_local(r.p!)})`;
    });
    out.plain_language_summary = `${sig.length} of ${rowsOut.length} pairs differed by more than chance would explain, after adjusting for the number of comparisons: ${parts.join("; ")}.`;
    out.apa_sentence = [
      R(`Tukey HSD comparisons of ${outcome} showed significant differences between `),
      ...sig.flatMap((r, idx) => [R(`${idx ? "; " : ""}${r.a.level} and ${r.b.level} (`), R("Mdiff", true), R(` = ${f2(r.diff)}, `), R("p", true), R(` ${fmtP(r.p)})`)]),
      R("."),
    ];
  }
  out.apa_table = {
    number: 1,
    title: `Tukey HSD Comparisons of ${outcome} by ${gname}`,
    columns: columns(["Comparison", "Mdiff", "t", "df", "p", "g"]),
    column_groups: [],
    rows: rowsOut.map((r) => ({ cells: [textCell(r.term), numCell(r.diff), numCell(r.t), numCell(dfE, String(dfE)), r.p === null ? { type: "p_value", value: null, display: "—" } : { type: "p_value", value: r.p, display: fmtP(r.p) }, numCell(r.g)], indent: 0, kind: "data" as const })),
    notes: { general: [R("p"), R(" values are Holm-adjusted pairwise "), R("t", true), R(" tests on the pooled within-group variance (mock approximation of Tukey HSD's studentized range; "), R("g", true), R(" = Hedges' g).")], specific: [], probability: [] },
  };
  return out;
}

function p_phrase_local(p: number): string {
  const s = fmtP(p);
  return s[0] === "<" ? `p ${s}` : `p = ${s}`;
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
    case "t_test.paired":
      return pairedT(req, meta, cell, nRows);
    case "wilcoxon_signed_rank":
      return wilcoxonSignedRank(req, meta, cell, nRows);
    case "anova.one_way":
      return oneWayAnovaRun(req, meta, cell, nRows);
    case "anova.mixed":
      return mixedAnovaRun(req, meta, cell, nRows);
    case "kruskal_wallis":
      return kruskalWallisRun(req, meta, cell, nRows);
    case "posthoc.tukey":
      return tukeyPosthoc(req, meta, cell, nRows);
    default:
      invalid(`The mock engine can't run ${info.label} yet.`);
  }
}
