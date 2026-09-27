/**
 * Plain-language, one-line descriptions of what each analysis id does (grade 8-10), used on the
 * Decision step's radio cards (SPEC §7.2) so the person sees a real description of the test they're
 * choosing instead of generic t-test copy. Keys are canonical analysis ids from
 * contracts/analysis_ids.json. Every id that content/decision_tree.yaml lists as a `primary_test` or
 * `nonparametric_alternative` must have an entry here (enforced by testBlurbs.test.ts).
 */
export const TEST_BLURBS: Record<string, string> = {
  // t-tests
  "t_test.one_sample": "Compares your group's average to one fixed number; assumes the scores are roughly bell-shaped.",
  "t_test.independent": "Compares the averages of two independent groups; assumes bell-shaped data with similar spread.",
  "t_test.paired": "Compares each person's two scores to see if they typically differ; assumes the differences are roughly bell-shaped.",

  // rank-based alternatives
  wilcoxon_one_sample: "Compares your group's scores to one fixed number using ranks instead of raw numbers.",
  mann_whitney: "Compares two independent groups by ranking all the scores together; doesn't need bell-shaped data.",
  wilcoxon_signed_rank: "Compares each person's two scores using ranks instead of raw numbers; doesn't need bell-shaped differences.",
  sign_test: "Looks only at whether each score went up or down, ignoring how much; the simplest, least powerful option.",
  kruskal_wallis: "Compares three or more independent groups by ranking all the scores together; doesn't need bell-shaped data.",
  friedman: "Compares three or more repeated measurements using ranks instead of raw scores; doesn't need bell-shaped data.",

  // ANOVA family
  "anova.one_way": "Compares the averages of three or more independent groups at once; assumes bell-shaped data with similar spread.",
  "anova.welch": "Compares the averages of three or more independent groups without assuming they spread out equally.",
  "anova.repeated_measures": "Compares three or more repeated measurements on the same people; assumes the differences are roughly bell-shaped.",
  "anova.factorial": "Compares averages across two or more grouping factors at once, including whether they interact.",
  "anova.mixed": "Compares groups over time, mixing a between-groups factor with a repeated within-person factor.",
  "anova.art": "Ranks the data first, then runs a factorial ANOVA on the ranks; a nonparametric stand-in for factorial or mixed designs.",
  ancova: "Compares group averages on an outcome while statistically adjusting for a covariate.",
  "ancova.quade": "A rank-based version of ANCOVA; adjusts for a covariate without needing bell-shaped data.",
  manova: "Compares group averages across several outcomes at once, accounting for how the outcomes relate to each other.",

  // correlation
  "correlation.pearson": "Measures the straight-line relationship between two continuous scores.",
  "correlation.spearman": "Measures whether two variables tend to rank in the same order; doesn't need a straight-line relationship.",
  "correlation.kendall_tau_b": "Measures rank agreement between two variables; a good choice for small samples or lots of tied values.",
  "correlation.point_biserial": "Measures the relationship between a continuous score and a yes/no variable.",
  "correlation.partial": "Measures the relationship between two variables while statistically controlling for a third.",

  // categorical
  "chi_square.independence": "Tests whether two categorical variables are related by comparing observed counts to what you'd expect if they weren't.",
  "chi_square.goodness_of_fit": "Tests whether one categorical variable's counts match an expected pattern.",
  fisher_exact: "Works out the exact probability of your table instead of relying on a large-sample approximation; the safe choice when expected counts are small.",
  mcnemar: "Compares paired yes/no answers from the same people at two time points.",
  cochran_q: "Compares paired yes/no answers from the same people across three or more time points or conditions.",

  // regression
  "regression.linear": "Predicts a continuous outcome from one or more predictors and estimates how much each one matters.",
  "regression.hierarchical": "Builds a linear regression in blocks, so you can see how much each block of predictors adds on its own.",
  "regression.logistic": "Predicts a yes/no outcome from one or more predictors.",
  "regression.ordinal": "Predicts an ordered outcome, like a rating scale, from one or more predictors.",

  // reliability
  "reliability.cronbach_alpha": "Measures how consistently a set of items measures the same underlying thing.",
  "reliability.mcdonald_omega": "Measures internal consistency like Cronbach's alpha, but without assuming every item is equally good.",
  "reliability.split_half": "Measures reliability by splitting the items in half and comparing the two halves.",
  "reliability.item_analysis": "Looks at how each item in a scale relates to the total, to spot weak or miscoded items.",
  "reliability.kr20": "Measures internal consistency for a scale made of right/wrong (0/1) items.",

  // validity
  "validity.efa": "Explores how a set of items group into underlying factors, without assuming a structure in advance.",
  "validity.cfa": "Tests whether a set of items fits a factor structure you specified in advance.",
};

const FALLBACK_RECOMMENDED = "A parametric test: compares averages and is the most powerful choice when its assumptions hold.";
const FALLBACK_ALTERNATIVE = "Works with ranks instead of raw scores, so it doesn't need bell-shaped data.";

/** Plain-language one-liner for an analysis id, or `fallback` (with a dev-only console.warn) when the id isn't mapped yet. */
export function blurbFor(analysisId: string | null | undefined, fallback: string): string {
  if (!analysisId) return fallback;
  const blurb = TEST_BLURBS[analysisId];
  if (blurb === undefined && import.meta.env?.DEV) {
    console.warn(`testBlurbs: no plain-language description mapped for analysis id "${analysisId}"`);
  }
  return blurb ?? fallback;
}

export const RECOMMENDED_FALLBACK_BLURB = FALLBACK_RECOMMENDED;
export const ALTERNATIVE_FALLBACK_BLURB = FALLBACK_ALTERNATIVE;
