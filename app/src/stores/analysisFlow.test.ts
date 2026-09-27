import { beforeEach, describe, expect, it } from "vitest";
import { resetAnalysisSession } from "@/lib/analysisSession";
import { outcomeCandidates } from "@/lib/datasetContext";
import type { MockEngine } from "@/mocks/engine";
import { answerLabel, useAdvisor } from "@/stores/advisor";
import { rpc } from "@/lib/rpc";
import { newRequestId } from "@/lib/resultSummary";
import { suggestedChoice, useAnalysisFlow } from "@/stores/analysisFlow";
import { useDatasetStore } from "@/stores/dataset";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";
import { importMockCategoricalOutcomes, importMockOneGroup, useFreshMock } from "@/test/mockTransport";

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
    expect(a.context).toMatchObject({ outcome_level: "continuous", num_groups: 1, num_time_points: 2, linked_mode: false });
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

  it("never runs a one-sample test against a silent default; requires and pre-fills a test value", async () => {
    await importMockOneGroup();
    await useAnalysisFlow.getState().loadCatalog();
    // Q3_1 is a 1-5 Likert item; its response_range drives the suggested midpoint.
    useAnalysisFlow.setState({ outcome: "Q3_1" });
    useAnalysisFlow.getState().selectAnalysis("t_test.one_sample");
    useAnalysisFlow.getState().setRole("outcome", ["Q3_1"]);
    let f = useAnalysisFlow.getState();
    expect(f.testValue).toBe("3");
    expect(f.testValueHint).toMatch(/middle of a 1–5 scale/);

    f.setTestValue("");
    expect(await useAnalysisFlow.getState().runCheck()).toBe(false);
    expect(useAnalysisFlow.getState().error).toMatch(/Tell Statly the value to compare against/);
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

  it("pre-selects the alternative when expected_cell_counts fails or cautions, using its explanation as the reason", async () => {
    await toRecommendation();
    await useAnalysisFlow.getState().runCheck();
    const r = structuredClone(useAnalysisFlow.getState().check!.result);
    for (const x of r.assumptions) x.verdict = "passed";
    const expectedCounts = {
      schema_version: 1 as const,
      assumption: "expected_cell_counts",
      label: "Expected cell counts",
      test_used: { key: "expected_cell_counts_rule", label: "Expected cell counts (rule of thumb)" },
      statistic: { symbol: "E_min", value: 3.3, df: [] as [] },
      p: null,
      verdict: "failed" as const,
      explanation: "25% of the cells have an expected count below 5 (smallest 3.30). Because the smallest expected count (3.30) is below 5, this check fails. Fisher's exact test doesn't rely on large counts.",
      applies_to: { kind: "overall" as const, label: "Q4 × Q3", group: null, n: 300 },
      chart_refs: [],
    };
    r.assumptions.push(expectedCounts);
    expect(suggestedChoice(r, true)).toEqual({ choice: "alternative", reason: expectedCounts.explanation });
    // "caution" still counts as a failure for this check.
    r.assumptions[r.assumptions.length - 1] = { ...expectedCounts, verdict: "caution" };
    expect(suggestedChoice(r, true).choice).toBe("alternative");
    // A passing check doesn't force the alternative.
    r.assumptions[r.assumptions.length - 1] = { ...expectedCounts, verdict: "passed" };
    expect(suggestedChoice(r, true).choice).toBe("recommended");
    // No alternative available: the expected_cell_counts branch never fires.
    r.assumptions[r.assumptions.length - 1] = { ...expectedCounts, verdict: "failed" };
    expect(suggestedChoice(r, false).choice).toBe("recommended");
  });

  it("runs and logs an alternative for an already-logged result, independent of the guided-flow state", async () => {
    await importMockCategoricalOutcomes();
    const meta = useDatasetStore.getState().meta!;
    const request = {
      schema_version: 1 as const,
      request_id: newRequestId(),
      analysis_id: "chi_square.independence",
      dataset_id: meta.dataset_id,
      snapshot_id: meta.snapshot_id,
      variables: { row: ["Q4"], column: ["Q3"] },
      subset: [],
      options: {},
      corrections: [],
      alpha: 0.05,
      tails: "two_sided" as const,
      ci_level: 0.95,
    };
    const result = await rpc.analysisRun(request);
    const chiSquareFailed = result.assumptions.find((a) => a.assumption === "expected_cell_counts")?.verdict === "failed";
    expect(chiSquareFailed).toBe(true); // Q4 x Q3 is the sparse table the warning is about.

    const entryId = await useAnalysisFlow.getState().runAlternative(result, "fisher_exact");
    expect(entryId).not.toBeNull();
    const log = useProjectStore.getState().project!.test_log;
    expect(log.map((e) => e.request.analysis_id)).toEqual(["fisher_exact"]);
    expect(log[0].request.variables).toEqual({ row: ["Q4"], column: ["Q3"] });
    expect(useResults.getState().currentId).toBe(entryId);
    expect(useResults.getState().byId[entryId!].analysis_id).toBe("fisher_exact");
  });
});
