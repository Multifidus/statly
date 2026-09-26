/**
 * Mock-engine stand-in for the dataset-free power.* analyses (engine/statly_engine/stats/power.py).

 * Normal approximations (t tests with Guenther's small-sample correction) only (close to, not identical with, the engine's exact noncentral
 * distributions); enough for VITE_STATLY_MOCK=1 and Playwright.
 */
import type { AnalysisRequest, AnalysisResult, ApaTable, Statistic } from "@/contracts";

const CONV: Record<string, Record<string, number>> = {
  d: { small: 0.2, medium: 0.5, large: 0.8 },
  f: { small: 0.1, medium: 0.25, large: 0.4 },
  r: { small: 0.1, medium: 0.3, large: 0.5 },
  w: { small: 0.1, medium: 0.3, large: 0.5 },
  f2: { small: 0.02, medium: 0.15, large: 0.35 },
};

function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const pnorm = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
function qnorm(p: number): number {
  let lo = -10;
  let hi = 10;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (pnorm(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Wilson-Hilferty chi-square quantile. */
function qchisq(p: number, df: number): number {
  const z = qnorm(p);
  const a = 2 / (9 * df);
  return df * Math.pow(1 - a + z * Math.sqrt(a), 3);
}

interface Prob {
  es: string;
  power: (n: number, e: number) => number;
  nMin: number;
  meaning: "per group" | "pairs" | "in total";
  total: (n: number) => number;
  n2?: (n: number) => number;
  test: string;
}

function invalid(message: string): never {
  throw { kind: "rpc", code: -32003, message, data: { type: "InvalidParams" } };
}

function problem(req: AnalysisRequest): Prob {
  const o = (req.options ?? {}) as Record<string, unknown>;
  const alpha = req.alpha;
  const zc = req.tails === "two_sided" ? qnorm(1 - alpha / 2) : qnorm(1 - alpha);
  const fPow = (lam: number, df: number) => pnorm(Math.sqrt(Math.max(lam, 0)) - Math.sqrt(qchisq(1 - alpha, df)));
  switch (req.analysis_id) {
    case "power.t_test": {
      const design = String(o.design ?? "independent");
      if (design === "independent") {
        const ratio = Number(o.allocation_ratio ?? 1);
        const n2 = (n: number) => Math.ceil(n * ratio);
        return { es: "d", power: (n, d) => { const m = Math.max(n - (zc * zc) / 4, 0.01); return pnorm(Math.abs(d) * Math.sqrt((m * m * ratio) / (m + m * ratio)) - zc); }, nMin: 2, meaning: "per group", total: (n) => n + n2(n), n2, test: "independent-samples t test" };
      }
      return { es: "d", power: (n, d) => pnorm(Math.abs(d) * Math.sqrt(Math.max(n - (zc * zc) / 2, 0.01)) - zc), nMin: 2, meaning: design === "paired" ? "pairs" : "in total", total: (n) => n, test: design === "paired" ? "paired-samples t test" : "one-sample t test" };
    }
    case "power.anova": {
      const design = String(o.design ?? "one_way");
      const k = Number(o.groups ?? (design === "rm_within" ? 1 : 3));
      if (design === "one_way") return { es: "f", power: (n, f) => fPow(k * n * f * f, k - 1), nMin: 2, meaning: "per group", total: (n) => n * k, test: `one-way ANOVA with ${k} groups` };
      const m = Number(o.measurements ?? 3);
      const rho = Number(o.correlation ?? 0.5);
      const lam = (n: number, f: number) => (design === "rm_between" ? (f * f * n * m) / (1 + (m - 1) * rho) : (f * f * n * m) / (1 - rho));
      const df = design === "rm_between" ? k - 1 : design === "rm_within" ? m - 1 : (k - 1) * (m - 1);
      return { es: "f", power: (n, f) => fPow(lam(n, f), Math.max(df, 1)), nMin: k + 1, meaning: "in total", total: (n) => Math.ceil(n / k) * k, test: design === "mixed_interaction" ? "mixed ANOVA, group × time interaction" : "repeated-measures ANOVA" };
    }
    case "power.correlation":
      return { es: "r", power: (n, r) => pnorm(Math.abs(Math.atanh(r)) * Math.sqrt(n - 3) - zc), nMin: 4, meaning: "in total", total: (n) => n, test: "test of a Pearson correlation" };
    case "power.chi_square": {
      const df = o.df ? Number(o.df) : o.rows && o.columns ? (Number(o.rows) - 1) * (Number(o.columns) - 1) : o.categories ? Number(o.categories) - 1 : invalid("Give the degrees of freedom, the table size, or the number of categories.");
      return { es: "w", power: (n, w) => fPow(n * w * w, df), nMin: 2, meaning: "in total", total: (n) => n, test: `chi-square test with ${df} df` };
    }
    case "power.regression": {
      const p = Number(o.predictors ?? 1);
      const q = Number(o.tested_predictors ?? p);
      return { es: "f2", power: (n, f2) => fPow(f2 * n, q), nMin: p + 2, meaning: "in total", total: (n) => n, test: "multiple regression" };
    }
    default:
      return invalid(`Unknown power analysis ${req.analysis_id}.`);
  }
}

function solveN(pr: Prob, e: number, target: number): number {
  let n = pr.nMin;
  while (pr.power(n, e) < target) {
    n++;
    if (n > 1e6) invalid("That effect is too small to detect with any realistic sample.");
  }
  return n;
}

function solveEffect(pr: Prob, n: number, target: number): number {
  let lo = 1e-6;
  let hi = pr.es === "r" ? 0.9999 : 10;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (pr.power(n, mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const R = (text: string, italic = false) => ({ text, italic });
const stat = (key: string, label: string, symbol: string, value: number): Statistic => ({ key, label, symbol, value, df: [], p: null, term: null });

export function mockPowerRun(req: AnalysisRequest): AnalysisResult {
  const o = (req.options ?? {}) as Record<string, unknown>;
  const pr = problem(req);
  const target = Number(o.power ?? 0.8);
  const mode = String(o.mode ?? "a_priori");
  if (mode !== "a_priori" && mode !== "sensitivity") invalid("Statly doesn't calculate post hoc power. Run a sensitivity analysis instead.");
  const statistics: Statistic[] = [];
  let summary: string;
  let centre: number;
  let effect: number;
  if (mode === "a_priori") {
    const raw = o.effect_size;
    effect = typeof raw === "string" ? (CONV[pr.es][raw] ?? invalid("Unknown effect size label.")) : Number(raw);
    if (!Number.isFinite(effect) || effect === 0) invalid("Enter the effect size you expect, or choose small, medium or large.");
    const n = solveN(pr, effect, target);
    centre = n;
    statistics.push(stat("n_required", `Required sample size (${pr.meaning}, rounded up)`, "n", n), stat("n_exact", "Exact solution before rounding", "n", n - 0.4), stat("n_total", "Total sample size", "N", pr.total(n)));
    if (pr.n2) statistics.push(stat("n2_required", "Required size of group 2", "n", pr.n2(n)));
    statistics.push(stat("achieved_power", "Power at the planned sample size", "1 − β", pr.power(n, effect)));
    summary = `To have a ${target * 100}% chance of detecting an effect of ${pr.es} = ${effect.toFixed(2)} with a ${pr.test} at α = ${req.alpha}, you need about ${n} participants ${pr.meaning} (${pr.total(n)} in total). Plan to recruit more if you expect people to drop out or skip questions.`;
  } else {
    const n = Number(o.n);
    if (!Number.isFinite(n) || n < pr.nMin) invalid("A sensitivity analysis needs the planned sample size ('n').");
    centre = n;
    effect = solveEffect(pr, n, target);
    statistics.push(stat("detectable_effect", "Smallest detectable effect", pr.es, effect), stat("power", "Target power", "1 − β", target), stat("n_total", "Total sample size", "N", pr.total(n)));
    summary = `With ${n} participants ${pr.meaning}, a ${pr.test} at α = ${req.alpha} has a ${target * 100}% chance of detecting an effect of ${pr.es} = ${effect.toFixed(2)} or larger. Smaller true effects would often be missed.`;
  }
  const curve: Record<string, number | string>[] = [];
  const series: Record<string, number> = { planned: effect, ...CONV[pr.es] };
  const hi = Math.max(centre * 2, centre + 10);
  for (const [name, e] of Object.entries(series)) {
    for (let i = 0; i <= 30; i++) {
      const n = Math.max(pr.nMin, Math.round(pr.nMin + ((hi - pr.nMin) * i) / 30));
      curve.push({ series: name, effect: e, n, n_total: pr.total(n), power: pr.power(n, e), target_power: target });
    }
  }
  const note = `${mode === "a_priori" ? "A priori" : "Sensitivity"} analysis. Mock engine: normal approximation.`;
  const table: ApaTable = {
    number: 1,
    title: "Power Analysis",
    columns: [
      { key: "test", header: [R("Test")], align: "left" },
      { key: "n", header: [R("n", true)], align: "decimal" },
      { key: "total", header: [R("N", true)], align: "decimal" },
    ],
    column_groups: [],
    rows: [{ cells: [{ type: "text", text: [R(pr.test)] }, { type: "number", value: centre, display: String(centre) }, { type: "number", value: pr.total(centre), display: String(pr.total(centre)) }], indent: 0, kind: "data" }],
    notes: { general: [R(note)], specific: [], probability: [] },
  };
  const bench: ApaTable = {
    number: null,
    title: "Conventional Effect-Size Benchmarks",
    columns: [
      { key: "size", header: [R("Benchmark")], align: "left" },
      { key: "value", header: [R(pr.es, true)], align: "decimal" },
      ...(mode === "a_priori" ? [{ key: "n", header: [R(`Required n (${pr.meaning})`)], align: "decimal" as const }] : []),
    ],
    column_groups: [],
    rows: Object.entries(CONV[pr.es]).map(([k, v]) => ({
      cells: [
        { type: "text" as const, text: [R(k[0].toUpperCase() + k.slice(1))] },
        { type: "number" as const, value: v, display: v.toFixed(2) },
        ...(mode === "a_priori" ? [{ type: "number" as const, value: solveN(pr, v, target), display: String(solveN(pr, v, target)) }] : []),
      ],
      indent: 0,
      kind: "data" as const,
    })),
    notes: { general: [R("Benchmarks from Cohen (1988). In education research, effects are usually judged against similar studies.")], specific: [], probability: [] },
  };
  return {
    schema_version: 1,
    analysis_id: req.analysis_id,
    statistics,
    effect_sizes: [],
    assumptions: [],
    descriptives: { continuous: [], frequencies: [] },
    plain_language_summary: summary,
    apa_sentence: [R(summary)],
    apa_table: table,
    additional_tables: [bench],
    warnings: [],
    chart_data: { power_curve: curve },
    inputs: { request: req, dataset_id: null, snapshot_id: null, n_used: 0, n_excluded: 0, n_by_group: [] },
    engine_version: "0.1.0-mock",
    timestamp: new Date().toISOString(),
  };
}
