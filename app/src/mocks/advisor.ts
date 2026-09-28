/**
 * Mock Test Advisor: a small slice of content/decision_tree.yaml (same question/recommendation
 * ids and semantics as the engine's pure evaluator) so mock mode and e2e run offline without
 * Python. The real tree is the source of truth; this only has to be shaped like it.
 */
import type { AdvisorPath, AdvisorQuestion, AdvisorRecommendation, AdvisorStep, AnswerValue, DatasetContext } from "@/lib/analysisRpc";

type Auto = { field: keyof DatasetContext; rules: { when: { equals?: unknown; min?: number; max?: number }; value: AnswerValue }[] };
type QNode = { type: "question"; text: string; why: string; hint?: string; auto?: Auto; options: { value: AnswerValue; label: string; description?: string; next: string }[] };
type RNode = { type: "recommendation" } & Omit<AdvisorRecommendation, "id">;
type Node = QNode | RNode;

const COUNT = (field: keyof DatasetContext): Auto => ({ field, rules: [{ when: { equals: 2 }, value: "two" }, { when: { min: 3 }, value: "three_plus" }] });

const rec = (o: Partial<RNode> & Pick<RNode, "primary_test" | "why_this_test">): RNode => ({
  type: "recommendation",
  nonparametric_alternative: null,
  assumptions: [],
  effect_size: [],
  post_hoc: [],
  likert_note: null,
  caveats: [],
  ...o,
});

const TREE: { root: string; nodes: Record<string, Node> } = {
  root: "q_intent",
  nodes: {
    q_intent: {
      type: "question",
      text: "What do you want to know?",
      why: "Statly picks a test by first understanding the shape of your question, then the shape of your data.",
      hint: "Different questions call for different statistical tests, so start with what you're trying to find out.",
      options: [
        { value: "compare", label: "Did scores change over time, or differ between groups?", description: "For example, comparing test scores before and after a workshop.", next: "q_compare_outcome_level" },
        { value: "relate", label: "Are two things related?", description: "For example, whether hours studied is related to exam score.", next: "q_relate_variable_types" },
        { value: "reliability", label: "Do my survey questions hang together?", description: "For example, checking whether ten survey items all measure classroom engagement.", next: "rec_alpha" },
      ],
    },
    q_compare_outcome_level: {
      type: "question",
      text: "What is your outcome (the thing you're comparing)?",
      why: "How a variable is measured decides the whole family of tests available for it.",
      hint: "The outcome is the variable you're comparing across groups or time points; how it's measured decides which test fits.",
      auto: { field: "outcome_level", rules: ["nominal", "ordinal", "continuous"].map((v) => ({ when: { equals: v }, value: v })) },
      options: [
        { value: "nominal", label: "A category, like pass/fail or yes/no", description: "For example, whether each student passed or failed the course.", next: "rec_chi_square" },
        { value: "ordinal", label: "A single rating question (e.g. one 1-5 Likert item)", description: "For example, one question like \"I enjoyed this class\" rated 1 to 5.", next: "rec_mann_whitney" },
        { value: "continuous", label: "A score, like a test total or a scale average", description: "For example, a 0-100 exam score, or the average of ten survey items.", next: "q_compare_design" },
      ],
    },
    q_compare_design: {
      type: "question",
      text: "What are you comparing?",
      why: "This decides the overall family of test: comparing to a fixed value, independent groups, the same people over time, or time points you can't link.",
      hint: "This sets the overall type of test: comparing to a fixed number, comparing separate groups, or tracking the same people over time.",
      options: [
        { value: "vs_fixed_value", label: "Comparing to a known or expected value (e.g. a benchmark score)", description: "For example, checking whether a class's average score differs from a passing threshold of 70.", next: "rec_t_one_sample" },
        { value: "independent_groups", label: "Independent groups (different people in each group/condition)", description: "For example, comparing average scores between students taught by two different methods.", next: "q_compare_between_groups_count" },
        { value: "repeated_linked", label: "Same respondents, measured more than once (linked)", description: "For example, the same students' scores before and after tutoring, matched by student ID.", next: "q_compare_time_points" },
        { value: "repeated_aggregate", label: "Comparing time points, but respondents are NOT linked across them", description: "For example, comparing this year's average score to last year's, with no way to match students.", next: "q_compare_aggregate_groups" },
      ],
    },
    q_compare_between_groups_count: {
      type: "question",
      text: "How many groups?",
      why: "Two groups use a t-test; three or more need an ANOVA so you don't run many t-tests.",
      hint: "A group is one of the categories of your grouping variable, like each class section.",
      auto: COUNT("num_groups"),
      options: [
        { value: "two", label: "Two", description: "For example, comparing test scores between two teaching methods.", next: "rec_t_independent" },
        { value: "three_plus", label: "Three or more", description: "For example, comparing test scores across three or more class sections.", next: "rec_anova_one_way" },
      ],
    },
    q_compare_time_points: {
      type: "question",
      text: "How many time points or conditions?",
      why: "Two linked time points use a paired test; three or more need a repeated-measures test.",
      hint: "A time point is one occasion the same people were measured, like before and after an intervention.",
      auto: COUNT("num_time_points"),
      options: [
        { value: "two", label: "Two", description: "For example, the same students' scores measured once before and once after a workshop.", next: "rec_t_paired" },
        { value: "three_plus", label: "Three or more", description: "For example, the same students' scores measured at the start, middle, and end of a semester.", next: "q_compare_between_factor_rm" },
      ],
    },
    q_compare_between_factor_rm: {
      type: "question",
      text: "Do you also have a between-subjects grouping variable (e.g. control vs. intervention)?",
      why: "Repeated measures on their own is a different design from a mixed design, where you also want to know whether different groups change differently over time.",
      hint: "A between-subjects grouping variable divides people into separate groups (like control vs. intervention), on top of the repeated time points everyone shares.",
      options: [
        { value: "no", label: "No, just repeated measures", description: "For example, tracking one group's scores across three time points, with no comparison groups.", next: "rec_anova_rm" },
        { value: "yes", label: "Yes, groups measured across the same time points", description: "For example, comparing a control group's scores over time to an intervention group's.", next: "rec_anova_mixed" },
      ],
    },
    q_compare_aggregate_groups: {
      type: "question",
      text: "How many time points are you comparing?",
      why: "Without linked IDs, each time point is treated as its own group of people.",
      hint: "Aggregate means you can't match individual respondents across time points, so each time point is compared as its own group.",
      auto: COUNT("num_time_points"),
      options: [
        { value: "two", label: "Two", description: "For example, comparing this year's average score to last year's, without linking students.", next: "rec_t_independent_aggregate" },
        { value: "three_plus", label: "Three or more", description: "For example, comparing average scores across three unlinked school years.", next: "rec_anova_one_way" },
      ],
    },
    rec_t_one_sample: rec({ primary_test: "t_test.one_sample", nonparametric_alternative: "wilcoxon_one_sample", assumptions: ["normality"], effect_size: ["cohens_d"], why_this_test: "A one-sample t-test checks whether your group's average differs from a known value." }),
    rec_t_independent: rec({ primary_test: "t_test.independent", nonparametric_alternative: "mann_whitney", assumptions: ["normality", "homogeneity_of_variance", "independence_of_observations"], effect_size: ["hedges_g"], why_this_test: "An independent-samples t-test compares the average score of two separate groups." }),
    rec_t_independent_aggregate: rec({
      primary_test: "t_test.independent",
      nonparametric_alternative: "mann_whitney",
      assumptions: ["normality", "homogeneity_of_variance"],
      effect_size: ["hedges_g"],
      why_this_test: "Your time points can't be linked to the same students, so each time point is treated as its own group and compared with an independent-samples t-test.",
      caveats: ["aggregate_time_comparison"],
    }),
    rec_t_paired: rec({ primary_test: "t_test.paired", nonparametric_alternative: "wilcoxon_signed_rank", assumptions: ["normality_of_differences"], effect_size: ["cohens_d_z"], why_this_test: "A paired-samples t-test compares the same people at two time points." }),
    rec_anova_one_way: rec({ primary_test: "anova.one_way", nonparametric_alternative: "kruskal_wallis", assumptions: ["normality", "homogeneity_of_variance"], effect_size: ["eta_squared"], post_hoc: ["posthoc.tukey"], why_this_test: "A one-way ANOVA compares three or more group averages in one test." }),
    rec_anova_rm: rec({ primary_test: "anova.repeated_measures", nonparametric_alternative: "friedman", assumptions: ["normality", "sphericity"], effect_size: ["partial_eta_squared"], why_this_test: "A repeated-measures ANOVA compares the same people across three or more time points." }),
    rec_anova_mixed: rec({
      primary_test: "anova.mixed",
      nonparametric_alternative: "anova.art",
      assumptions: ["normality", "sphericity", "homogeneity_of_variance"],
      effect_size: ["partial_eta_squared", "omega_squared"],
      post_hoc: ["posthoc.pairwise"],
      why_this_test: "A mixed ANOVA combines a between-subjects grouping variable (e.g. control vs. intervention) with a within-subjects factor (time), so you can see the group x time interaction.",
    }),
    // Relate branch (correlation): "What kind of variables are you relating?" (mirrors
    // content/decision_tree.yaml q_relate_variable_types/q_relate_ordinal_detail; only the two
    // options the app currently exercises, per this file's "shaped like it" contract).
    q_relate_variable_types: {
      type: "question",
      text: "What kind of variables are you relating?",
      why: "The right correlation coefficient depends on how both variables are measured.",
      hint: "Correlation measures how two variables move together; the right coefficient depends on how each variable is measured.",
      options: [
        { value: "continuous_continuous", label: "Both are scores or scale totals (continuous)", description: "For example, hours studied and exam score, both measured as numbers.", next: "rec_pearson" },
        { value: "ordinal_involved", label: "One or both are ranks or single rating-scale items (ordinal)", description: "For example, a single satisfaction rating (1-5) and exam score.", next: "q_relate_ordinal_detail" },
      ],
    },
    q_relate_ordinal_detail: {
      type: "question",
      text: "Do you have a small sample or a lot of tied ranks (e.g. many identical ratings)?",
      why: "Spearman's correlation is the usual rank-based choice. Kendall's tau-b handles tied ranks more precisely and tends to be more reliable in small samples.",
      hint: "A tied rank happens when two or more responses share the exact same rating, which is common with small rating scales.",
      auto: { field: "second_distinct", rules: [{ when: { max: 7 }, value: "yes" }] },
      options: [
        { value: "no", label: "No, use the usual choice", description: "Use Spearman's correlation, the standard rank-based choice.", next: "rec_spearman" },
        { value: "yes", label: "Yes", description: "For example, a survey with only 15 respondents, or a 5-point scale where many people picked the same rating.", next: "rec_kendall" },
      ],
    },
    rec_spearman: rec({ primary_test: "correlation.spearman", nonparametric_alternative: "correlation.kendall_tau_b", assumptions: ["monotonic_relationship"], effect_size: ["spearman_rho"], why_this_test: "Spearman's correlation measures the strength of a monotonic relationship using ranks, which fits ordinal data such as a single rating-scale item." }),
    rec_kendall: rec({ primary_test: "correlation.kendall_tau_b", assumptions: ["monotonic_relationship"], effect_size: ["kendall_tau_b"], why_this_test: "Kendall's tau-b measures the relationship between two ranked variables based on how often pairs of observations agree in order. It handles tied ranks explicitly, which makes it a good choice for a small sample or many identical ratings." }),
    rec_mann_whitney: rec({ primary_test: "mann_whitney", assumptions: ["similar_shape_of_distributions"], effect_size: ["rank_biserial"], why_this_test: "A Mann-Whitney U test compares two groups using ranks.", likert_note: "A single Likert item is ordinal: the gaps between answer choices aren't guaranteed to be equal, so a rank-based test is recommended." }),
    rec_chi_square: rec({ primary_test: "chi_square.independence", nonparametric_alternative: "fisher_exact", assumptions: ["expected_cell_counts"], effect_size: ["cramers_v"], why_this_test: "A chi-square test checks whether two categorical variables are related." }),
    rec_pearson: rec({ primary_test: "correlation.pearson", nonparametric_alternative: "correlation.spearman", assumptions: ["linearity", "normality"], effect_size: ["pearson_r"], why_this_test: "A Pearson correlation measures how strongly two scores move together." }),
    rec_alpha: rec({ primary_test: "reliability.cronbach_alpha", assumptions: ["tau_equivalence"], why_this_test: "Cronbach's alpha tells you how consistently a set of items measures the same thing." }),
  },
};

function autoValue(auto: Auto | undefined, ctx: DatasetContext): AnswerValue | null {
  if (!auto) return null;
  const v = ctx[auto.field];
  if (v === undefined || v === null) return null;
  for (const r of auto.rules) {
    if ("equals" in r.when && r.when.equals === v) return r.value;
    if (r.when.min !== undefined && typeof v === "number" && v >= r.when.min) return r.value;
    if (r.when.max !== undefined && typeof v === "number" && v <= r.when.max) return r.value;
  }
  return null;
}

export function mockAdvisorEvaluate(answers: Record<string, AnswerValue>, ctx: DatasetContext = {}): AdvisorStep {
  const path: AdvisorStep["path"] = [];
  let id = TREE.root;
  for (let guard = 0; guard < 50; guard++) {
    const node = TREE.nodes[id];
    if (node.type === "recommendation") {
      const { type: _t, ...r } = node;
      return { next_question: null, recommendation: { id, ...r }, path };
    }
    const auto = autoValue(node.auto, ctx);
    const question: AdvisorQuestion = { id, text: node.text, why: node.why, hint: node.hint, options: node.options.map(({ value, label, description }) => ({ value, label, description })), auto_answer: auto };
    let value: AnswerValue;
    let source: "user" | "auto";
    if (id in answers) [value, source] = [answers[id], "user"];
    else if (auto !== null) [value, source] = [auto, "auto"];
    else return { next_question: question, recommendation: null, path };
    const opt = node.options.find((o) => o.value === value);
    if (!opt) throw Object.assign(new Error(`'${String(value)}' is not an option of ${id}`), { kind: "rpc", code: -32003, message: `'${String(value)}' is not an option of ${id}`, data: { type: "InvalidParams" } });
    path.push({ question: id, value, source });
    id = opt.next;
  }
  throw new Error("advisor tree cycle");
}

export function mockAdvisorPaths(): AdvisorPath[] {
  const out: AdvisorPath[] = [];
  const walk = (id: string, steps: AdvisorPath["answers"]) => {
    const node = TREE.nodes[id];
    if (node.type === "recommendation") {
      const { type: _t, ...r } = node;
      out.push({ answers: steps, recommendation: { id, ...r } });
      return;
    }
    for (const o of node.options) walk(o.next, [...steps, { question: id, value: o.value, label: o.label }]);
  };
  walk(TREE.root, []);
  return out;
}
