/**
 * Display names and plain-language text for the snake_case ids the decision tree and the engine
 * use (assumptions, effect sizes, caveats). Analysis labels come from `analysis.list` when the
 * engine registers the id; these are the fallbacks and the ids that have no analysis.
 */
import { learnPageFor } from "@/lib/content/learn";

const LABELS: Record<string, string> = {
  // assumptions
  normality: "Normality (bell-shaped scores)",
  normality_of_differences: "Normality of the differences",
  normality_of_residuals: "Normality of the residuals",
  homogeneity_of_variance: "Equal spread across groups",
  homoscedasticity: "Equal spread of residuals",
  independence_of_observations: "Independent observations",
  independence_of_pairs: "Independent pairs",
  independence_of_residuals: "Independent residuals",
  sphericity: "Sphericity",
  outliers: "No extreme outliers",
  linearity: "Linearity",
  expected_cell_counts: "Large enough expected counts",
  similar_shape_of_distributions: "Similar shapes across groups",
  symmetry_of_differences: "Symmetric differences",
  monotonic_relationship: "A steadily rising or falling relationship",
  multicollinearity: "Predictors not too strongly related",
  sample_size: "Enough participants",
  // effect sizes
  cohens_d: "Cohen's d",
  cohens_d_z: "Cohen's d (z)",
  cohens_d_av: "Cohen's d (av)",
  d_z: "Cohen's d (z)",
  d_av: "Cohen's d (av)",
  hedges_g: "Hedges' g",
  glass_delta: "Glass's delta",
  eta_squared: "Eta squared",
  partial_eta_squared: "Partial eta squared",
  omega_squared: "Omega squared",
  epsilon_squared: "Epsilon squared",
  cohens_f: "Cohen's f",
  f_squared: "Cohen's f²",
  r_squared: "R²",
  rank_biserial: "Rank-biserial correlation",
  kendalls_w: "Kendall's W",
  cramers_v: "Cramér's V",
  phi: "Phi",
  odds_ratio: "Odds ratio",
  pearson_r: "Pearson's r",
  spearman_rho: "Spearman's rho",
  kendall_tau_b: "Kendall's tau-b",
  point_biserial_r: "Point-biserial r",
};

/** Plain-language caveats (decision_tree.yaml `caveats[]`). */
export const CAVEAT_TEXT: Record<string, string> = {
  aggregate_time_comparison:
    "Your time points are compared as if they were separate groups of people, because the answers can't be linked to the same students. That is the honest choice, but it is less powerful than a paired test and can't tell you how individual students changed. If you can link responses (for example with a student ID), a paired test is better.",
  multinomial_outcome_not_supported:
    "Statly can't yet model an outcome with three or more unordered categories. Consider combining categories or asking for help with a multinomial model.",
  small_sample_cfa:
    "Confirmatory factor analysis usually needs a few hundred responses to give stable results. Treat results from a small sample with caution.",
  small_sample_efa:
    "Exploratory factor analysis usually needs at least 100 to 200 responses. Treat results from a small sample with caution.",
};

export function humanize(id: string): string {
  const s = id.replace(/[._]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Best display name for an id: explicit label, catalog label, Learn page title, then humanized. */
export function labelFor(id: string, catalog?: Record<string, string>): string {
  return catalog?.[id] ?? LABELS[id] ?? learnPageFor(id)?.title ?? humanize(id);
}

export function caveatText(id: string): string {
  return CAVEAT_TEXT[id] ?? humanize(id) + ".";
}
