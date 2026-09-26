import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/contracts";
import type { AdvisorRecommendation } from "@/lib/analysisRpc";
import { mockPowerRun } from "@/mocks/power";
import { buildPlan, designFacts, plannedAnalyses, powerAnalysisEntry, recommendations, treeAnswers, type InterviewAnswer, type PowerSettings } from "@/lib/planner/planText";
import { powerPlanFor } from "@/lib/planner/powerMapping";
import { powerRequest } from "@/stores/planner";

const PAIRED: AdvisorRecommendation = {
  id: "rec_t_paired",
  primary_test: "t_test.paired",
  nonparametric_alternative: "wilcoxon_signed_rank",
  assumptions: ["normality_of_differences"],
  effect_size: ["cohens_d_z"],
  post_hoc: [],
  why_this_test: "A paired-samples t-test compares the same people at two times.",
  likert_note: null,
  caveats: [],
};
const INDEP: AdvisorRecommendation = { ...PAIRED, id: "rec_t_independent", primary_test: "t_test.independent", nonparametric_alternative: "mann_whitney", assumptions: ["normality", "homogeneity_of_variance"], effect_size: ["hedges_g"], why_this_test: "Compares two groups." };

const INTERVIEW: InterviewAnswer[] = [
  { question: "q_intent", value: "compare", text: "What do you want to know?", label: "Did scores change over time, or differ between groups?" },
  { question: "q_compare_design", value: "repeated_linked", text: "What are you comparing?", label: "Same respondents, measured more than once (linked)" },
  { question: "q_compare_time_points", value: "two", text: "How many time points or conditions?", label: "Two" },
];
const SETTINGS: PowerSettings = { effect: 0.5, alpha: 0.05, power: 0.8, tails: "two_sided", options: { design: "paired" }, dropoutPct: 10 };

function run(test: string, s: PowerSettings, mode: "a_priori" | "sensitivity" = "a_priori", n?: number): AnalysisResult {
  return mockPowerRun(powerRequest(powerPlanFor(test), s, mode, n));
}

describe("plan text", () => {
  it("planned analyses carry the rationale and a backup test", () => {
    const pa = plannedAnalyses(PAIRED, { "t_test.paired": "Paired-samples t test" });
    expect(pa).toHaveLength(2);
    expect(pa[0]).toMatchObject({ analysis_id: "t_test.paired", label: "Paired-samples t test", effect_size: "cohens_d_z", assumptions_to_check: ["normality_of_differences"] });
    expect(pa[1].analysis_id).toBe("wilcoxon_signed_rank");
    expect(pa[1].rationale).toMatch(/assumptions don't hold/);
  });

  it("linked designs get the self-generated ID, same-wording and anonymous-link advice", () => {
    const recs = recommendations(treeAnswers({ q_compare_design: "repeated_linked" }), PAIRED, { plan: powerPlanFor("t_test.paired"), nTotal: 34, recruit: 38 });
    const text = recs.map((r) => r.text).join("\n");
    expect(text).toMatch(/self-generated ID/);
    expect(text).toMatch(/exactly the same question wording/);
    expect(text).toMatch(/anonymous survey link can't recognise/);
    expect(text).toMatch(/recode values/);
    expect(text).toMatch(/Survey Preview/);
    expect(text).toMatch(/at least 34 usable responses.*about 38/);
    expect(recs.every((r) => r.why.length > 10)).toBe(true);
    expect(new Set(recs.map((r) => r.category))).toEqual(new Set(["design", "data_collection", "qualtrics_setup", "analysis"]));
  });

  it("independent groups skip the ID question but ask to record the group", () => {
    const answers = { q_compare_design: "independent_groups", q_compare_between_groups_count: "two" };
    expect(designFacts(answers, INDEP)).toMatchObject({ linked: false, groups: true });
    const text = recommendations(answers, INDEP, null).map((r) => r.text).join("\n");
    expect(text).not.toMatch(/self-generated ID/);
    expect(text).toMatch(/Record which group/);
    expect(text).toMatch(/Prevent multiple submissions/);
  });

  it("power entries follow the StudyPlan contract", () => {
    const plan = powerPlanFor("t_test.independent");
    const s: PowerSettings = { ...SETTINGS, options: { ...plan.options } };
    const a = powerAnalysisEntry(plan, s, run("t_test.independent", s), "a_priori");
    expect(a).toMatchObject({ analysis_id: "t_test.independent", mode: "a_priori", inputs: { alpha: 0.05, power: 0.8, effect_size_metric: "d", effect_size: 0.5, n_total: null, n_groups: 2, allocation_ratio: 1 } });
    expect(a.outputs?.n_total).toBeGreaterThan(100);
    expect(a.outputs?.n_per_group).toHaveLength(2);
    const sens = powerAnalysisEntry(plan, s, run("t_test.independent", s, "sensitivity", 30), "sensitivity");
    expect(sens.inputs).toMatchObject({ effect_size: null, n_total: 60 });
    expect(sens.outputs?.detectable_effect).toBeGreaterThan(0.6);
    expect(sens.outputs?.achieved_power).toBeNull();
  });

  it("buildPlan assembles summary, answers, analyses, power and recommendations", () => {
    const plan = powerPlanFor("t_test.paired");
    const apriori = run("t_test.paired", SETTINGS);
    const sp = buildPlan({
      id: "plan_x",
      title: "  Reading attitudes  ",
      researchQuestion: "Do attitudes improve?",
      createdAt: "2026-09-01T00:00:00Z",
      now: "2026-09-02T00:00:00Z",
      interview: INTERVIEW,
      advice: PAIRED,
      labels: {},
      power: { plan, settings: SETTINGS, apriori, sensitivity: null },
    });
    expect(sp.title).toBe("Reading attitudes");
    expect(sp.design.answers).toMatchObject({ q_intent: "compare", q_compare_design: "repeated_linked", planner_research_question: "Do attitudes improve?" });
    expect(treeAnswers(sp.design.answers)).not.toHaveProperty("planner_research_question");
    expect(sp.design.summary).toMatch(/^You want to find out: Did scores change/);
    expect(sp.design.summary).toMatch(/Sample size: at least \d+ people in total \(recruit about \d+/);
    expect(sp.power_analyses).toHaveLength(1);
    expect(sp.power_analyses[0].inputs.effect_size_metric).toBe("d_z");
    expect(sp.planned_analyses[0].analysis_id).toBe("t_test.paired");
    expect(sp.recommendations.length).toBeGreaterThan(5);
  });

  it("a reopened plan keeps its stored power analyses until recalculated", () => {
    const stored = powerAnalysisEntry(powerPlanFor("t_test.paired"), SETTINGS, run("t_test.paired", SETTINGS), "a_priori");
    const sp = buildPlan({ id: "p", title: "T", researchQuestion: "", createdAt: "x", now: "y", interview: INTERVIEW, advice: PAIRED, labels: {}, power: null, keptPower: [stored], keptDropoutPct: 0 });
    expect(sp.power_analyses).toEqual([stored]);
    expect(sp.design.summary).toContain(`at least ${stored.outputs!.n_total} people`);
  });
});
