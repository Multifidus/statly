/**
 * Study Planner (SPEC §11.2): map the advisor's recommended test to a dataset-free `power.*`
 * analysis (engine/statly_engine/stats/power.py) and sensible starting options.
 *
 * Mapping (recommended test -> power analysis, design):
 *   t_test.independent, mann_whitney                      -> power.t_test  independent (d)
 *   t_test.paired, wilcoxon_signed_rank, sign_test        -> power.t_test  paired (d_z)
 *   t_test.one_sample, wilcoxon_one_sample                -> power.t_test  one_sample (d)
 *   anova.one_way, anova.welch, kruskal_wallis            -> power.anova   one_way, k groups (f)
 *   ancova                                                -> power.anova   one_way (conservative: ignores the covariate)
 *   anova.factorial, manova                               -> power.anova   one_way over all cells (approximation)
 *   anova.repeated_measures, friedman                     -> power.anova   rm_within, m measurements (f)
 *   anova.mixed                                           -> power.anova   mixed_interaction, k groups x m (f)
 *   chi_square.independence                               -> power.chi_square rows x columns (w)
 *   chi_square.goodness_of_fit                            -> power.chi_square categories (w)
 *   correlation.pearson / point_biserial                  -> power.correlation (r)
 *   correlation.spearman / kendall_tau_b / partial        -> power.correlation (r; approximation)
 *   regression.linear                                     -> power.regression, p predictors (f2)
 *   regression.hierarchical                               -> power.regression, R² change for the added block (f2)
 *   anything else (mcnemar, cochran_q, logistic/ordinal regression, reliability, EFA/CFA, unknown)
 *                                                         -> fallback power.t_test with an explanation
 * Rank-based tests (Mann-Whitney, Wilcoxon, Kruskal-Wallis, Friedman, Spearman, Kendall, sign test)
 * are planned with their parametric twin plus about 15% more people (their efficiency relative to
 * the parametric test is at least 86.4% for common shapes, Lehmann 1975).
 */
import type { AnswerValue } from "@/lib/analysisRpc";

export type PowerAnalysisId = "power.t_test" | "power.anova" | "power.correlation" | "power.chi_square" | "power.regression";
/** Effect-size metric used by the power analysis (power.py): d, f, r, w, f2. */
export type PowerMetric = "d" | "f" | "r" | "w" | "f2";
export type MatchKind = "direct" | "approximate" | "fallback";

export type PowerOptions = Record<string, string | number>;

export interface PowerPlan {
  powerId: PowerAnalysisId;
  /** Design options sent in AnalysisRequest.options (design, groups, measurements, ...). */
  options: PowerOptions;
  metric: PowerMetric;
  match: MatchKind;
  /** Planned test is rank-based: add RANK_INFLATION more people. */
  rankBased: boolean;
  /** Plain-language explanation of how the power calculation relates to the planned test. */
  note: string;
  /** Test family the calculation is for (StudyPlan PowerAnalysis.analysis_id). */
  familyId: string;
}

/** Extra people for rank-based tests (1 / 0.864 ≈ 1.157). */
export const RANK_INFLATION = 1.15;

const RANK_TESTS = new Set([
  "mann_whitney",
  "wilcoxon_signed_rank",
  "wilcoxon_one_sample",
  "sign_test",
  "kruskal_wallis",
  "friedman",
  "correlation.spearman",
  "correlation.kendall_tau_b",
]);

/** Answer values that mean "three or more" in the decision tree. */
function threePlus(answers: Record<string, AnswerValue>, ids: string[]): boolean {
  return ids.some((id) => answers[id] === "three_plus");
}

const GROUP_QS = ["q_compare_between_groups_count", "q_compare_ordinal_groups", "q_compare_aggregate_groups", "q_compare_ordinal_aggregate"];
const TIME_QS = ["q_compare_time_points", "q_compare_ordinal_time"];

const RANK_NOTE =
  "Your planned test works with ranks, so the calculation uses its regular (parametric) twin and then adds about 15% more people, because rank-based tests need a few more people to be as sensitive.";

/** Map a recommended analysis id (advisor `primary_test`) to a power analysis. */
export function powerPlanFor(test: string, answers: Record<string, AnswerValue> = {}): PowerPlan {
  const rankBased = RANK_TESTS.has(test);
  const k = threePlus(answers, GROUP_QS) ? 3 : 2;
  const m = threePlus(answers, TIME_QS) ? 3 : 2;
  const withRank = (note: string) => (rankBased ? `${note} ${RANK_NOTE}` : note);
  const base = { rankBased };

  switch (test) {
    case "t_test.independent":
    case "mann_whitney":
      return { ...base, powerId: "power.t_test", options: { design: "independent", allocation_ratio: 1 }, metric: "d", match: "direct", familyId: "t_test.independent", note: withRank("Sample size for comparing two separate groups with a t test.") };
    case "t_test.paired":
    case "wilcoxon_signed_rank":
    case "sign_test":
      return { ...base, powerId: "power.t_test", options: { design: "paired" }, metric: "d", match: "direct", familyId: "t_test.paired", note: withRank("Sample size for the same people measured twice (paired t test). The effect here is the average change divided by the spread of the change scores (dz).") };
    case "t_test.one_sample":
    case "wilcoxon_one_sample":
      return { ...base, powerId: "power.t_test", options: { design: "one_sample" }, metric: "d", match: "direct", familyId: "t_test.one_sample", note: withRank("Sample size for comparing one group's average with a fixed value.") };
    case "anova.one_way":
    case "anova.welch":
    case "kruskal_wallis":
      return { ...base, powerId: "power.anova", options: { design: "one_way", groups: Math.max(k, 3) }, metric: "f", match: "direct", familyId: "anova.one_way", note: withRank("Sample size for comparing three or more separate groups (one-way ANOVA).") };
    case "ancova":
      return { ...base, powerId: "power.anova", options: { design: "one_way", groups: k }, metric: "f", match: "approximate", familyId: "ancova", note: "Statly sizes the group comparison as a one-way ANOVA. Adjusting for a pretest usually adds power, so this number is on the safe (larger) side." };
    case "anova.factorial":
    case "manova":
      return { ...base, powerId: "power.anova", options: { design: "one_way", groups: 4 }, metric: "f", match: "approximate", familyId: "anova.one_way", note: "This is an approximation: Statly treats every combination of your groups as one set of groups (for example, 2 × 2 = 4 groups). Effects that depend on a combination of factors (interactions) usually need more people." };
    case "anova.repeated_measures":
    case "friedman":
      return { ...base, powerId: "power.anova", options: { design: "rm_within", groups: 1, measurements: Math.max(m, 3), correlation: 0.5, epsilon: 1 }, metric: "f", match: "direct", familyId: "anova.repeated_measures", note: withRank("Sample size for the same people measured three or more times (repeated-measures ANOVA). It assumes the scores at different times correlate about 0.5.") };
    case "anova.mixed":
      return { ...base, powerId: "power.anova", options: { design: "mixed_interaction", groups: k, measurements: m, correlation: 0.5, epsilon: 1 }, metric: "f", match: "direct", familyId: "anova.mixed", note: "Sample size for whether groups change differently over time (the group × time interaction in a mixed ANOVA). It assumes the scores at different times correlate about 0.5." };
    case "chi_square.independence":
      return { ...base, powerId: "power.chi_square", options: { rows: 2, columns: 2 }, metric: "w", match: "direct", familyId: "chi_square.independence", note: "Sample size for a chi-square test of whether two categories are related. Set the number of rows and columns of your table." };
    case "chi_square.goodness_of_fit":
      return { ...base, powerId: "power.chi_square", options: { categories: 3 }, metric: "w", match: "direct", familyId: "chi_square.goodness_of_fit", note: "Sample size for a chi-square test comparing your category counts with expected counts." };
    case "correlation.pearson":
    case "correlation.point_biserial":
      return { ...base, powerId: "power.correlation", options: {}, metric: "r", match: "direct", familyId: "correlation.pearson", note: "Sample size for testing whether two measures are related (correlation)." };
    case "correlation.spearman":
    case "correlation.kendall_tau_b":
    case "correlation.partial":
      return { ...base, powerId: "power.correlation", options: {}, metric: "r", match: "approximate", familyId: "correlation.pearson", note: withRank(test === "correlation.partial" ? "Statly sizes this as a plain correlation. Controlling for another variable uses up a little information, so add a few people." : "Statly sizes this as a Pearson correlation.") };
    case "regression.linear":
      return { ...base, powerId: "power.regression", options: { predictors: answers.q_predict_predictor_count === "one" ? 1 : 3 }, metric: "f2", match: "direct", familyId: "regression.linear", note: "Sample size for testing whether your predictors together explain the outcome (R² in multiple regression). Set how many predictors you plan to use." };
    case "regression.hierarchical":
      return { ...base, powerId: "power.regression", options: { predictors: 3, tested_predictors: 1 }, metric: "f2", match: "direct", familyId: "regression.hierarchical", note: "Sample size for testing whether the predictors you add in the last step explain more (R² change)." };
    default:
      return { ...base, rankBased: false, powerId: "power.t_test", options: { design: "independent", allocation_ratio: 1 }, metric: "d", match: "fallback", familyId: "t_test.independent", note: fallbackNote(test) };
  }
}

function fallbackNote(test: string): string {
  if (test.startsWith("reliability.") || test.startsWith("validity.")) {
    return "Power analysis doesn't apply directly to reliability or factor analysis. A common rule of thumb is at least 100 people for reliability and at least 200 (or 5–10 per question) for factor analysis. The t test calculation below is only a stand-in in case you also plan to compare two groups.";
  }
  if (test === "mcnemar" || test === "cochran_q") {
    return "Statly has no direct power calculation for this yes/no before-and-after test. As a stand-in it uses a t test comparing two groups, which gives a rough, usually safe, starting number. Ask a statistician if the exact number matters.";
  }
  if (test.startsWith("regression.")) {
    return "Statly has no direct power calculation for this kind of regression. As a stand-in it uses a t test comparing the two outcome groups, which gives a rough starting number. A common rule of thumb is also at least 10 people in the smaller outcome group for each predictor.";
  }
  return "Statly has no direct power calculation for this test, so it uses a t test comparing two groups as a rough stand-in.";
}

/** Conventional benchmarks (Cohen, 1988), as power.py CONVENTIONS. */
export const BENCHMARKS: Record<PowerMetric, { small: number; medium: number; large: number }> = {
  d: { small: 0.2, medium: 0.5, large: 0.8 },
  f: { small: 0.1, medium: 0.25, large: 0.4 },
  r: { small: 0.1, medium: 0.3, large: 0.5 },
  w: { small: 0.1, medium: 0.3, large: 0.5 },
  f2: { small: 0.02, medium: 0.15, large: 0.35 },
};

export const METRIC_INFO: Record<PowerMetric, { symbol: string; name: string; plain: string }> = {
  d: { symbol: "d", name: "Cohen's d", plain: "the difference between averages, in standard deviations" },
  f: { symbol: "f", name: "Cohen's f", plain: "how spread out the group averages are, compared with the spread inside groups" },
  r: { symbol: "r", name: "correlation r", plain: "how strongly two measures go together (0 = not at all, 1 = perfectly)" },
  w: { symbol: "w", name: "Cohen's w", plain: "how far the category counts are from what you'd expect by chance" },
  f2: { symbol: "f²", name: "Cohen's f²", plain: "how much of the outcome the predictors explain, as R² ÷ (1 − R²)" },
};

/** StudyPlan PowerInputs.effect_size_metric (paired t test uses dz). */
export function contractMetric(plan: PowerPlan): string {
  if (plan.metric === "d" && plan.options.design === "paired") return "d_z";
  return plan.metric === "f2" ? "f_sq" : plan.metric;
}

/** Whether a one-sided test is possible (F and chi-square tests are always two-sided). */
export function allowsOneSided(id: PowerAnalysisId): boolean {
  return id === "power.t_test" || id === "power.correlation";
}

/** Recruit this many to end up with `n` after `dropoutPct`% loss, plus the rank inflation. */
export function recruitTarget(n: number, dropoutPct: number, rankBased: boolean): number {
  const inflated = rankBased ? Math.ceil(n * RANK_INFLATION) : n;
  const keep = 1 - Math.min(Math.max(dropoutPct, 0), 90) / 100;
  return Math.ceil(inflated / keep - 1e-9);
}
