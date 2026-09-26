/**
 * Study Planner text (SPEC §11.2): turn the design interview, the advisor's recommendation and the
 * power results into a StudyPlan (contracts/StudyPlan.json). Pure functions, unit-tested.
 */
import type {
  AnalysisResult,
  PlannedAnalysis,
  PowerAnalysis,
  PowerInputs,
  PowerMode,
  Recommendation,
  StudyPlan,
  Tails,
} from "@/contracts";
import type { AdvisorRecommendation, AnswerValue } from "@/lib/analysisRpc";
import { labelFor } from "@/lib/content/labels";
import { contractMetric, recruitTarget, type PowerPlan } from "@/lib/planner/powerMapping";

/** decision_tree.yaml `version` the interview ran against (advisor.* doesn't echo it). */
export const DECISION_TREE_VERSION = "1";
/** Non-tree key in DesignAnswers.answers holding the student's research question. */
export const RESEARCH_QUESTION_KEY = "planner_research_question";

export interface InterviewAnswer {
  question: string;
  value: AnswerValue;
  /** Question text shown to the student. */
  text: string;
  /** Label of the chosen option. */
  label: string;
}

export interface PowerSettings {
  effect: number;
  alpha: number;
  power: number;
  tails: Tails;
  options: Record<string, string | number>;
  /** Expected drop-out / unusable responses, percent. */
  dropoutPct: number;
}

/** Only decision-tree answers (question ids start with `q_`), e.g. to pre-fill the advisor. */
export function treeAnswers(answers: StudyPlan["design"]["answers"]): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (k.startsWith("q_") && !Array.isArray(v)) out[k] = v;
  }
  return out;
}

export function statValue(result: AnalysisResult | null | undefined, key: string): number | null {
  const s = result?.statistics.find((x) => x.key === key);
  return s && s.value !== null && Number.isFinite(s.value) ? s.value : null;
}

const plainRuns = (runs: { text: string }[] | null | undefined) => (runs ?? []).map((r) => r.text).join("");

function num(v: string | number | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Chi-square df from the planner options (rows/columns or categories). */
export function chiDf(options: Record<string, string | number>): number | null {
  const rows = num(options.rows);
  const cols = num(options.columns);
  if (rows && cols) return (rows - 1) * (cols - 1);
  const cats = num(options.categories);
  return cats ? cats - 1 : null;
}

function inputsFor(plan: PowerPlan, s: PowerSettings, mode: PowerMode, nTotal: number | null): PowerInputs {
  const o = s.options;
  const design = String(o.design ?? "");
  const inputs: PowerInputs = {
    alpha: s.alpha,
    power: s.power,
    tails: s.tails,
    effect_size_metric: contractMetric(plan),
    effect_size: mode === "a_priori" ? s.effect : null,
    n_total: mode === "sensitivity" ? nTotal : null,
  };
  if (plan.powerId === "power.t_test" && design === "independent") {
    inputs.n_groups = 2;
    inputs.allocation_ratio = num(o.allocation_ratio) ?? 1;
  }
  if (plan.powerId === "power.anova") {
    inputs.n_groups = num(o.groups);
    if (design !== "one_way") {
      inputs.n_measurements = num(o.measurements);
      inputs.correlation_among_measures = num(o.correlation);
      if (design !== "rm_between") inputs.nonsphericity_epsilon = num(o.epsilon);
    }
  }
  if (plan.powerId === "power.chi_square") inputs.df = chiDf(o);
  if (plan.powerId === "power.regression") inputs.n_predictors = num(o.predictors);
  return inputs;
}

function perGroup(plan: PowerPlan, s: PowerSettings, result: AnalysisResult, mode: PowerMode): number[] | null {
  const design = String(s.options.design ?? "");
  const total = statValue(result, "n_total");
  if (plan.powerId === "power.t_test" && design === "independent") {
    if (mode === "a_priori") {
      const n1 = statValue(result, "n_required");
      const n2 = statValue(result, "n2_required") ?? n1;
      return n1 !== null && n2 !== null ? [n1, n2] : null;
    }
    const ratio = num(s.options.allocation_ratio) ?? 1;
    const n1 = total !== null ? Math.round(total / (1 + ratio)) : null;
    return n1 !== null && total !== null ? [n1, total - n1] : null;
  }
  if (plan.powerId === "power.anova") {
    const k = num(s.options.groups) ?? 1;
    if (k < 2 || total === null) return null;
    return Array.from({ length: k }, () => Math.round(total / k));
  }
  return null;
}

/** One StudyPlan PowerAnalysis from an engine power.* result. */
export function powerAnalysisEntry(plan: PowerPlan, s: PowerSettings, result: AnalysisResult | null, mode: PowerMode): PowerAnalysis {
  const nTotal = result ? statValue(result, "n_total") : null;
  const inputs = inputsFor(plan, s, mode, mode === "sensitivity" ? nTotal : null);
  if (!result) return { analysis_id: plan.familyId, mode, inputs, outputs: null };
  const note = [plainRuns(result.apa_table?.notes.general), plan.match !== "direct" ? plan.note : ""].filter(Boolean).join(" ");
  const detectable = mode === "sensitivity" ? statValue(result, "detectable_effect") : null;
  return {
    analysis_id: plan.familyId,
    mode,
    inputs,
    outputs: {
      n_total: nTotal,
      n_per_group: perGroup(plan, s, result, mode),
      detectable_effect: detectable === null ? null : Math.round(detectable * 10000) / 10000,
      achieved_power: mode === "a_priori" ? statValue(result, "achieved_power") : null,
      method_note: note || "Computed by Statly's power analysis.",
    },
  };
}

/** Planned analyses: the recommended test plus its nonparametric backup. */
export function plannedAnalyses(rec: AdvisorRecommendation, labels: Record<string, string> = {}): PlannedAnalysis[] {
  const primary: PlannedAnalysis = {
    analysis_id: rec.primary_test,
    label: labelFor(rec.primary_test, labels),
    rationale: rec.why_this_test.trim(),
    nonparametric_alternative: rec.nonparametric_alternative,
    assumptions_to_check: [...rec.assumptions],
    effect_size: rec.effect_size[0] ?? null,
    follow_ups: [...rec.post_hoc],
  };
  if (!rec.nonparametric_alternative) return [primary];
  const alt: PlannedAnalysis = {
    analysis_id: rec.nonparametric_alternative,
    label: `${labelFor(rec.nonparametric_alternative, labels)} (backup)`,
    rationale: `Use this instead of the ${labelFor(rec.primary_test, labels)} if its assumptions don't hold, for example if the scores are very lopsided or have extreme outliers. It works with ranks, so it is less affected by unusual scores.`,
    nonparametric_alternative: null,
    assumptions_to_check: [],
    effect_size: null,
    follow_ups: [],
  };
  return [primary, alt];
}

const PAIRED_TESTS = new Set(["t_test.paired", "wilcoxon_signed_rank", "sign_test", "anova.repeated_measures", "friedman", "anova.mixed", "mcnemar", "cochran_q"]);

export interface DesignFacts {
  linked: boolean;
  aggregateTime: boolean;
  multipleTimes: boolean;
  groups: boolean;
  covariate: boolean;
  ordinal: boolean;
  categorical: boolean;
  psychometric: boolean;
}

export function designFacts(answers: Record<string, AnswerValue>, rec: AdvisorRecommendation | null): DesignFacts {
  const test = rec?.primary_test ?? "";
  const vals = Object.values(answers).map(String);
  const linked = PAIRED_TESTS.has(test) || vals.includes("repeated_linked") || vals.some((v) => v.startsWith("linked_"));
  const aggregateTime = vals.includes("repeated_aggregate");
  return {
    linked,
    aggregateTime,
    multipleTimes: linked || aggregateTime,
    groups: vals.includes("independent_groups") || vals.includes("two_groups_independent") || test === "anova.mixed" || test === "ancova" || answers.q_compare_between_factor_rm === "yes",
    covariate: test === "ancova" || test === "correlation.partial" || answers.q_compare_covariate_two === "yes" || answers.q_compare_covariate_three === "yes",
    ordinal: answers.q_compare_outcome_level === "ordinal" || !!rec?.likert_note,
    categorical: answers.q_compare_outcome_level === "nominal" || test.startsWith("chi_square") || test === "mcnemar" || test === "cochran_q",
    psychometric: test.startsWith("reliability.") || test.startsWith("validity."),
  };
}

const rec = (category: Recommendation["category"], text: string, why: string): Recommendation => ({ category, text, why });

/** Plain-language data-collection, Qualtrics and analysis advice for this design. */
export function recommendations(
  answers: Record<string, AnswerValue>,
  advice: AdvisorRecommendation | null,
  power: { plan?: PowerPlan; nTotal: number | null; recruit: number | null } | null,
): Recommendation[] {
  const f = designFacts(answers, advice);
  const out: Recommendation[] = [];

  out.push(rec("design", "Write down your research question, your main outcome and your planned test before you collect any data.", "Deciding in advance keeps you from picking the test that happens to give the nicest result, which makes your findings more trustworthy."));
  if (power?.nTotal) {
    const extra = power.recruit && power.recruit > power.nTotal ? ` Aim to recruit about ${power.recruit} so you still have enough after drop-outs and unusable responses.` : "";
    out.push(rec("data_collection", `Plan for at least ${power.nTotal} usable responses in total.${extra}`, "With fewer people, a real effect of the size you expect could easily be missed."));
  }
  if (f.linked || f.aggregateTime) {
    out.push(rec("data_collection", "Add the same self-generated ID question to every survey, for example: first two letters of your mother's first name + the day of the month you were born + the first two letters of the street you grew up on.", f.linked ? "Your analysis compares each person with themselves. Without a code that is identical on every survey, answers can't be matched and paired tests are impossible." : "Right now your time points can't be linked. Adding an ID question lets you match people later and use a paired test, which needs fewer people."));
    out.push(rec("data_collection", "Tell students to type their ID code the same way every time (same letters, no spaces) and show an example.", "Small typing differences, like 'Ma07' vs 'MA 07', stop Statly from matching the two surveys."));
  }
  if (f.multipleTimes) {
    out.push(rec("data_collection", "Use exactly the same question wording, answer options and response scale at every time point.", "If the wording or scale changes, a change in scores might come from the survey change rather than from real change in your students."));
    out.push(rec("qualtrics_setup", "Copy the first survey to make the later ones (Survey options → Copy survey) instead of rebuilding it.", "Copying keeps question wording, order and recode values identical across time points."));
  }
  if (f.groups) {
    out.push(rec("data_collection", "Record which group or condition each person is in, as a question or embedded data field in the survey itself.", "The analysis needs to know each person's group. Adding it later from memory or a separate list is error-prone."));
  }
  if (f.covariate) {
    out.push(rec("data_collection", "Collect the pretest (or other variable you plan to control for) before the intervention starts.", "A control variable measured after the intervention may itself be changed by it, which can hide or distort the effect."));
  }
  if (f.ordinal) {
    out.push(rec("design", "Keep every rating question on the same scale (for example, all 1–5 from 'Strongly disagree' to 'Strongly agree').", "Mixed scales can't be averaged into one score, and they confuse respondents."));
  }
  if (f.psychometric) {
    out.push(rec("design", "Include enough questions per idea you want to measure (at least three, ideally more) and write some reverse-worded questions carefully.", "Reliability and factor analysis need several questions per idea to give stable results."));
  }

  out.push(rec("qualtrics_setup", "Check the recode values of every multiple-choice and rating question (question → Recode values) so they run 1, 2, 3… in the order you expect.", "Qualtrics sometimes keeps odd codes (like 1, 2, 4, 5, 7) after you edit choices, which silently changes averages."));
  out.push(rec("qualtrics_setup", "Before you launch, delete your test responses, and when you export, leave out 'Survey Preview' responses (filter on Response Type or Status).", "Preview and test responses are not real participants and would be counted in your results."));
  if (f.linked) {
    out.push(rec("qualtrics_setup", "An anonymous survey link can't recognise the same person twice. Rely on the self-generated ID question (or a contact list with authenticated links) to match surveys.", "Qualtrics' anonymous link gives every response a new ID, so without your own ID question pre and post answers can't be matched."));
  } else {
    out.push(rec("qualtrics_setup", "If you use an anonymous link, turn on 'Prevent multiple submissions' (Survey options → Security).", "An anonymous link can be opened more than once, so the same person could be counted twice."));
  }
  out.push(rec("qualtrics_setup", "Use 'Request response' rather than 'Force response' for sensitive questions, and export with numeric values.", "Forcing answers can make people quit or guess. Numeric exports are easiest to analyse, though Statly can also read answer text."));

  if (advice?.nonparametric_alternative) {
    out.push(rec("analysis", `Check the assumptions first; if they don't hold, use the ${labelFor(advice.nonparametric_alternative)} instead.`, "Deciding the backup test now means the choice is based on your plan, not on which result looks better."));
  }
  if (advice && advice.post_hoc.length) {
    out.push(rec("analysis", "If the overall test is significant, run the planned follow-up tests to see which groups or time points differ.", "The overall test only says that some difference exists, not where it is."));
  }
  if (power?.plan?.rankBased) {
    out.push(rec("analysis", "Your planned test uses ranks, so the sample size includes about 15% more people than the matching t test or ANOVA.", "Rank-based tests are a little less sensitive, so they need a few more people to detect the same effect."));
  }
  return out;
}

/** Plain-language design summary for the plan (one paragraph per line). */
export function designSummary(interview: InterviewAnswer[], advice: AdvisorRecommendation | null, labels: Record<string, string>, power: { nTotal: number | null; recruit: number | null } | null): string {
  const lines: string[] = [];
  const goal = interview.find((a) => a.question === "q_intent");
  if (goal) lines.push(`You want to find out: ${goal.label}`);
  const rest = interview.filter((a) => a.question !== "q_intent");
  if (rest.length) lines.push(`Your design: ${rest.map((a) => `${a.text.replace(/\?$/, "")}: ${a.label}`).join("; ")}.`);
  if (advice) {
    const backup = advice.nonparametric_alternative ? `, with the ${labelFor(advice.nonparametric_alternative, labels)} as a backup if its assumptions don't hold` : "";
    lines.push(`Planned analysis: ${labelFor(advice.primary_test, labels)}${backup}.`);
  }
  if (power?.nTotal) {
    lines.push(`Sample size: at least ${power.nTotal} people in total` + (power.recruit && power.recruit > power.nTotal ? ` (recruit about ${power.recruit} to allow for drop-outs).` : "."));
  }
  return lines.join("\n");
}

export interface BuildPlanInput {
  id: string;
  title: string;
  researchQuestion: string;
  createdAt: string;
  now: string;
  interview: InterviewAnswer[];
  advice: AdvisorRecommendation | null;
  labels: Record<string, string>;
  power: { plan: PowerPlan; settings: PowerSettings; apriori: AnalysisResult | null; sensitivity: AnalysisResult | null } | null;
  /** Power analyses of a plan reopened from a project, kept when nothing was recalculated. */
  keptPower?: PowerAnalysis[];
  /** Drop-out percent to use with `keptPower`. */
  keptDropoutPct?: number;
}

/** Required total N and recruitment target (drop-outs + rank inflation) from an a priori result. */
export function sampleTargets(power: BuildPlanInput["power"], kept: PowerAnalysis[] = [], keptDropoutPct = 0): { nTotal: number | null; recruit: number | null } {
  if (!power?.apriori) {
    const n = kept.find((p) => p.mode === "a_priori")?.outputs?.n_total ?? null;
    return { nTotal: n, recruit: n === null ? null : recruitTarget(n, keptDropoutPct, !!power?.plan.rankBased) };
  }
  const nTotal = statValue(power.apriori, "n_total");
  if (nTotal === null) return { nTotal: null, recruit: null };
  return { nTotal, recruit: recruitTarget(nTotal, power.settings.dropoutPct, power.plan.rankBased) };
}

export function buildPlan(i: BuildPlanInput): StudyPlan {
  const answers: StudyPlan["design"]["answers"] = {};
  for (const a of i.interview) answers[a.question] = a.value;
  if (i.researchQuestion.trim()) answers[RESEARCH_QUESTION_KEY] = i.researchQuestion.trim();
  const fresh = !!i.power?.apriori;
  const targets = sampleTargets(i.power, fresh ? [] : i.keptPower, i.keptDropoutPct);
  const powerAnalyses: PowerAnalysis[] = fresh ? [] : [...(i.keptPower ?? [])];
  if (i.power?.apriori) powerAnalyses.push(powerAnalysisEntry(i.power.plan, i.power.settings, i.power.apriori, "a_priori"));
  if (fresh && i.power?.sensitivity) powerAnalyses.push(powerAnalysisEntry(i.power.plan, i.power.settings, i.power.sensitivity, "sensitivity"));
  return {
    schema_version: 1,
    id: i.id,
    title: i.title.trim() || "Untitled study",
    created_at: i.createdAt,
    modified_at: i.now,
    design: {
      decision_tree_version: DECISION_TREE_VERSION,
      answers,
      summary: designSummary(i.interview, i.advice, i.labels, targets),
    },
    planned_analyses: i.advice ? plannedAnalyses(i.advice, i.labels) : [],
    power_analyses: powerAnalyses,
    recommendations: recommendations(treeAnswers(answers), i.advice, i.power || targets.nTotal !== null ? { plan: i.power?.plan, ...targets } : null),
  };
}

export const CATEGORY_TITLES: Record<Recommendation["category"], string> = {
  design: "Study design",
  data_collection: "Collecting your data",
  qualtrics_setup: "Setting up your Qualtrics survey",
  analysis: "Analysing your data later",
};

/** Unique assumptions across the planned analyses, in order. */
export function assumptionChecklist(plan: StudyPlan): string[] {
  const seen: string[] = [];
  for (const a of plan.planned_analyses) for (const k of a.assumptions_to_check) if (!seen.includes(k)) seen.push(k);
  return seen;
}
