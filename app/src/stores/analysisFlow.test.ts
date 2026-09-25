import { beforeEach, describe, expect, it } from "vitest";
import { resetAnalysisSession } from "@/lib/analysisSession";
import { outcomeCandidates } from "@/lib/datasetContext";
import type { MockEngine } from "@/mocks/engine";
import { answerLabel, useAdvisor } from "@/stores/advisor";
import { suggestedChoice, useAnalysisFlow } from "@/stores/analysisFlow";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";
import { importMockOneGroup, useFreshMock } from "@/test/mockTransport";

let engine: MockEngine;
beforeEach(() => {
  engine = useFreshMock();
  resetAnalysisSession();
});

describe("advisor flow store", () => {
  it("derives dataset_context from roles and walks to a recommendation", async () => {
    const meta = await importMockOneGroup();
    const score = meta.scales[0].score_variable!;
    expect(outcomeCandidates(meta)[0].name).toBe(score);

    await useAdvisor.getState().start();
    let a = useAdvisor.getState();
    expect(a.outcome).toBe(score);
    expect(a.context).toEqual({ outcome_level: "continuous", num_groups: 1, num_time_points: 2, linked_mode: false });
    const startCall = engine.calls.find((c) => c.method === "advisor.start");
    expect(startCall?.params).toEqual({ dataset_context: a.context });

    await a.answer("q_intent", "compare");
    a = useAdvisor.getState();
    expect(a.step!.path.map((p) => [p.question, p.source])).toEqual([
      ["q_intent", "user"],
      ["q_compare_outcome_level", "auto"],
    ]);
    // Auto-answered question is known so it can be shown pre-filled and overridden.
    expect(answerLabel(a.questions.q_compare_outcome_level, "continuous")).toMatch(/score/i);

    await a.answer("q_compare_design", "repeated_aggregate");
    a = useAdvisor.getState();
    expect(a.step!.recommendation!.primary_test).toBe("t_test.independent");
    expect(a.step!.recommendation!.caveats).toEqual(["aggregate_time_comparison"]);
    // Sends the full answer set every time (stateless engine).
    const answers = engine.calls.filter((c) => c.method === "advisor.answer");
    const last = answers[answers.length - 1];
    expect(last.params).toMatchObject({ answers: { q_intent: "compare", q_compare_design: "repeated_aggregate" } });
  });

  it("overrides an auto answer and drops answers after it; back undoes the last explicit answer", async () => {
    await importMockOneGroup();
    await useAdvisor.getState().start();
    await useAdvisor.getState().answer("q_intent", "compare");
    await useAdvisor.getState().answer("q_compare_design", "repeated_aggregate");
    expect(useAdvisor.getState().step!.recommendation).not.toBeNull();

    // Override the auto-filled outcome level: later answers no longer apply.
    await useAdvisor.getState().answer("q_compare_outcome_level", "ordinal");
    let a = useAdvisor.getState();
    expect(a.answers).toEqual({ q_intent: "compare", q_compare_outcome_level: "ordinal" });
    expect(a.step!.recommendation!.primary_test).toBe("mann_whitney");
    expect(a.step!.recommendation!.likert_note).toMatch(/ordinal/);
    expect(a.step!.path[1]).toEqual({ question: "q_compare_outcome_level", value: "ordinal", source: "user" });

    // Back removes the override; the data's answer applies again.
    await a.back();
    a = useAdvisor.getState();
    expect(a.answers).toEqual({ q_intent: "compare" });
    expect(a.step!.path[1].source).toBe("auto");
    expect(a.step!.next_question!.id).toBe("q_compare_design");

    // One group in the data: the group-count question has no automatic answer.
    await a.answer("q_compare_design", "independent_groups");
    expect(useAdvisor.getState().step!.next_question).toMatchObject({ id: "q_compare_between_groups_count", auto_answer: null });
  });
});

async function toRecommendation() {
  const meta = await importMockOneGroup();
  await useAdvisor.getState().start();
  await useAdvisor.getState().answer("q_intent", "compare");
  await useAdvisor.getState().answer("q_compare_design", "repeated_aggregate");
  const a = useAdvisor.getState();
  await useAnalysisFlow.getState().setup(a.step!.recommendation!, a.outcome);
  return meta;
}

describe("guided analysis flow store", () => {
  it("pre-fills roles, runs once for assumptions, walks them and logs the chosen test", async () => {
    const meta = await toRecommendation();
    const score = meta.scales[0].score_variable!;
    let f = useAnalysisFlow.getState();
    expect(f.analysisId).toBe("t_test.independent");
    expect(f.layout).toBe("default");
    expect(f.roles).toEqual({ outcome: [score], group: ["Time"] });

    expect(await f.runCheck()).toBe(true);
    f = useAnalysisFlow.getState();
    expect(f.stage).toBe("assumptions");
    const n = f.check!.result.assumptions.length;
    expect(n).toBe(3);
    expect(useProjectStore.getState().project!.test_log).toHaveLength(0); // checking is not the logged run
    f.goAssumption(1);
    expect(useAnalysisFlow.getState().assumptionIndex).toBe(1);
    useAnalysisFlow.getState().goAssumption(n);
    expect(useAnalysisFlow.getState().stage).toBe("decision");

    expect(await useAnalysisFlow.getState().choose("recommended")).toBe(true);
    f = useAnalysisFlow.getState();
    const log = useProjectStore.getState().project!.test_log;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      id: f.check!.request.request_id,
      request: { analysis_id: "t_test.independent", variables: { outcome: [score], group: ["Time"] }, alpha: 0.05, tails: "two_sided", ci_level: 0.95 },
      result_summary: { analysis_label: "Independent-samples t test", outcome_variables: [score], n_used: 120 },
      family_id: null,
      correction_method: "none",
      adjusted_p: null,
    });
    expect(log[0].result_summary.primary_effect_size?.key).toBe("hedges_g");
    expect(useResults.getState().currentId).toBe(log[0].id);
    expect(useResults.getState().byId[log[0].id].analysis_id).toBe("t_test.independent");
    expect(useProjectStore.getState().dirty).toBe(true);
  });

  it("runs and logs the nonparametric alternative with the same variables", async () => {
    await toRecommendation();
    await useAnalysisFlow.getState().runCheck();
    expect(await useAnalysisFlow.getState().choose("alternative")).toBe(true);
    const log = useProjectStore.getState().project!.test_log;
    expect(log.map((e) => e.request.analysis_id)).toEqual(["mann_whitney"]);
    expect(log[0].result_summary.primary_effect_size?.key).toBe("rank_biserial");
  });

  it("explains missing variables and engine refusals in plain language", async () => {
    await toRecommendation();
    useAnalysisFlow.getState().setRole("group", []);
    expect(await useAnalysisFlow.getState().runCheck()).toBe(false);
    expect(useAnalysisFlow.getState().error).toMatch(/Groups to compare/);
    useAnalysisFlow.getState().setRole("group", ["Q3_1"]); // five levels, not two
    expect(await useAnalysisFlow.getState().runCheck()).toBe(false);
    expect(useAnalysisFlow.getState().error).toMatch(/exactly two groups/);
  });

  it("suggests the alternative when normality fails and confirms Welch for unequal spread", async () => {
    await toRecommendation();
    await useAnalysisFlow.getState().runCheck();
    const r = structuredClone(useAnalysisFlow.getState().check!.result);
    for (const x of r.assumptions) x.verdict = "passed";
    expect(suggestedChoice(r, true).choice).toBe("recommended");
    r.assumptions[2].verdict = "failed"; // homogeneity of variance
    expect(suggestedChoice(r, true)).toMatchObject({ choice: "recommended", reason: expect.stringMatching(/Welch/) });
    r.assumptions[0].verdict = "failed"; // normality
    expect(suggestedChoice(r, true).choice).toBe("alternative");
    expect(suggestedChoice(r, false).choice).toBe("recommended");
  });
});
