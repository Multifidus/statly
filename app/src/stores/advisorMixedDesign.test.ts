/**
 * Test Advisor reaches rec_anova_mixed for a real repeated-measures-with-groups dataset (linked
 * IDs, three groups, three time points -- the "large mixed design" practice dataset, fixtures/
 * practice/mixed_design_large), and the run form lets the person assign between + within/time
 * roles for it. Regression test for the mock advisor tree missing the mixed-design branch
 * (app/src/mocks/advisor.ts) and the mock catalog missing "anova.mixed" (app/src/mocks/analysis.ts).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { MockEngine } from "@/mocks/engine";
import { importMockMixedDesign, useFreshMock } from "@/test/mockTransport";
import { useAdvisor } from "@/stores/advisor";
import { useAnalysisFlow } from "@/stores/analysisFlow";
import { useDatasetStore } from "@/stores/dataset";

let engine: MockEngine;
beforeEach(() => {
  engine = useFreshMock();
  useAdvisor.getState().reset();
  useAnalysisFlow.getState().reset();
  void engine;
});

describe("Test Advisor: mixed ANOVA (between x within)", () => {
  it("derives a linked, three-time-point context from the dataset", async () => {
    const meta = await importMockMixedDesign();
    useDatasetStore.getState().setMeta(meta);
    const outcome = meta.variables.find((v) => v.role === "test_total")!.name;

    await useAdvisor.getState().start(outcome);
    const a = useAdvisor.getState();
    expect(a.context).toEqual({ outcome_level: "continuous", num_groups: 3, num_time_points: 3, linked_mode: true });
  });

  it("walks compare -> continuous -> repeated (linked) -> three or more -> has a between-subjects factor -> rec_anova_mixed", async () => {
    const meta = await importMockMixedDesign();
    useDatasetStore.getState().setMeta(meta);
    const outcome = meta.variables.find((v) => v.role === "test_total")!.name;

    await useAdvisor.getState().start(outcome);
    await useAdvisor.getState().answer("q_intent", "compare");
    await useAdvisor.getState().answer("q_compare_outcome_level", "continuous");
    await useAdvisor.getState().answer("q_compare_design", "repeated_linked");
    let a = useAdvisor.getState();
    // Three linked time points is auto-filled from the dataset (num_time_points: 3), so the
    // advisor walks straight past q_compare_time_points to the next open question.
    expect(a.step!.path.find((p) => p.question === "q_compare_time_points")).toMatchObject({ value: "three_plus", source: "auto" });
    expect(a.step!.next_question).toMatchObject({ id: "q_compare_between_factor_rm" });

    await useAdvisor.getState().answer("q_compare_between_factor_rm", "yes");
    a = useAdvisor.getState();
    expect(a.step!.recommendation).toMatchObject({ id: "rec_anova_mixed", primary_test: "anova.mixed" });

    // Continue into the run form: roles are reachable and pre-filled from the linked dataset.
    await useAnalysisFlow.getState().setup(a.step!.recommendation!, outcome);
    const f = useAnalysisFlow.getState();
    expect(f.analysisId).toBe("anova.mixed");
    const info = f.catalog!.find((x) => x.analysis_id === "anova.mixed")!;
    expect(info.layouts.map((l) => l.name).sort()).toEqual(["long", "wide"]);
    // The linked dataset has an id variable and a stacking time variable, so "long" scores best
    // and pre-fills the between-subjects group, the outcome, the participant id and time (the
    // within-subjects factor).
    expect(f.layout).toBe("long");
    expect(f.roles.between?.[0]).toBe("Q2");
    expect(f.roles.time?.length).toBeGreaterThan(0);
    expect(f.roles.subject_id?.[0]).toBe("Q1");
    expect(f.roles.outcome?.[0]).toBe(outcome);

    // The mock engine can actually run it (minimal mixed-ANOVA mock response).
    expect(await useAnalysisFlow.getState().runCheck()).toBe(true);
    const result = useAnalysisFlow.getState().check!.result;
    expect(result.analysis_id).toBe("anova.mixed");
    expect(result.statistics.map((s) => s.key)).toEqual(["F_between", "F_within", "F_interaction"]);
    expect(result.inputs.n_used).toBeGreaterThan(0);
  });
});
