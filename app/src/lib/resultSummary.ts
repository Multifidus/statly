/**
 * Per-family "headline" config (which effect size leads, which statistic is primary) and the
 * Test Log entry built from every analysis run (SPEC §9). Results rendering is otherwise generic
 * over AnalysisResult; this map is the only family-specific knowledge in the frontend.
 */
import type { AnalysisRequest, AnalysisResult, EffectSize, Statistic, TestLogEntry } from "@/contracts";

export interface Headline {
  /** Effect-size keys in order of preference for the headline. */
  effects: string[];
}

/** Keyed by analysis id, then by family prefix (text before the first dot). */
export const HEADLINES: Record<string, Headline> = {
  "t_test.independent": { effects: ["hedges_g", "cohens_d"] },
  "t_test.paired": { effects: ["d_z", "d_av", "cohens_d"] },
  "t_test.one_sample": { effects: ["cohens_d", "hedges_g"] },
  mann_whitney: { effects: ["rank_biserial", "r"] },
  wilcoxon_signed_rank: { effects: ["rank_biserial", "r"] },
  wilcoxon_one_sample: { effects: ["rank_biserial", "r"] },
  sign_test: { effects: ["rank_biserial", "r", "cohens_g"] },
  kruskal_wallis: { effects: ["epsilon_sq", "eta_sq_h", "eta_sq"] },
  friedman: { effects: ["kendall_w"] },
  "anova.one_way": { effects: ["eta_sq", "omega_sq", "partial_eta_sq"] },
  "anova.welch": { effects: ["omega_sq", "eta_sq"] },
  anova: { effects: ["partial_eta_sq", "generalized_eta_sq", "eta_sq", "omega_sq"] },
  chi_square: { effects: ["cramers_v", "phi", "cohens_w"] },
  fisher_exact: { effects: ["odds_ratio", "phi", "cramers_v"] },
  mcnemar: { effects: ["odds_ratio", "cohens_g"] },
  cochran_q: { effects: ["kendall_w", "eta_sq_q"] },
  correlation: { effects: ["r", "rho", "tau_b", "r_pb"] },
  reliability: { effects: [] },
};

export function headlineFor(analysisId: string): Headline {
  return HEADLINES[analysisId] ?? HEADLINES[analysisId.split(".")[0]] ?? { effects: [] };
}

export function primaryStatistic(result: AnalysisResult): Statistic | null {
  return result.statistics[0] ?? null;
}

export function primaryEffect(result: AnalysisResult): EffectSize | null {
  const { effects } = headlineFor(result.analysis_id);
  for (const key of effects) {
    const e = result.effect_sizes.find((x) => x.key === key && x.value !== null);
    if (e) return e;
  }
  return result.effect_sizes.find((e) => e.interpretation) ?? result.effect_sizes[0] ?? null;
}

/** Outcome variables of a request (used to detect related tests for families, Phase 6). */
export function outcomeVariables(req: AnalysisRequest): string[] {
  const v = req.variables;
  for (const k of ["outcome", "measures", "items", "variables", "y", "variable", "row"]) {
    if (v[k]?.length) return [...v[k]];
  }
  return Object.values(v).flat();
}

/** A new Test Log entry for one run: never in a family and never corrected (SPEC §9). */
export function makeTestLogEntry(request: AnalysisRequest, result: AnalysisResult, analysisLabel: string): TestLogEntry {
  const stat = primaryStatistic(result);
  return {
    schema_version: 1,
    id: request.request_id,
    timestamp: result.timestamp || new Date().toISOString(),
    request,
    result_summary: {
      analysis_label: analysisLabel,
      outcome_variables: outcomeVariables(request),
      primary_statistic: stat,
      p: stat?.p ?? null,
      primary_effect_size: primaryEffect(result),
      n_used: result.inputs.n_used,
      apa_sentence: result.apa_sentence,
      plain_language_summary: result.plain_language_summary,
      engine_version: result.engine_version,
    },
    // The engine has no RPC yet to store the full result inside the .statly zip, so the
    // entry points nowhere; the app keeps full results in memory and re-runs the stored
    // request (pure, same snapshot) to reopen older entries.
    result_path: null,
    family_id: null,
    correction_method: "none",
    adjusted_p: null,
  };
}

export function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
