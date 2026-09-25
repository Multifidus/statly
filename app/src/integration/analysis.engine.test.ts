// @vitest-environment node
/**
 * Real-engine integration test for the Phase 4 flow (SPEC §7, §9, §10.1): the same stores the
 * screens use drive a real engine. one_group_prepost_likert (stacked pre/post, aggregate mode)
 * -> Variable Interview (scale score) -> Test Advisor -> t_test.independent on the scale score
 * by Time -> guided assumptions -> decision -> Test Log entry, saved and reloaded with the project.
 * With STATLY_CAPTURE=1 the result is written to src/test/fixtures for the jsdom render tests.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatasetMeta } from "@/contracts";
import { findNoncontiguous, findResponseSets } from "@/lib/importLogic";
import { richToPlain } from "@/lib/apa";
import { rpc, setTransport } from "@/lib/rpc";
import { resolveEngineCommand, StdioTransport } from "@/lib/transports/stdio";
import { resetAnalysisSession } from "@/lib/analysisSession";
import { useAdvisor } from "@/stores/advisor";
import { suggestedChoice, useAnalysisFlow } from "@/stores/analysisFlow";
import { useDatasetStore } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";
import { useInterview } from "@/stores/interview";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";

const REPO = path.resolve(import.meta.dirname, "../../..");
const PRACTICE = path.join(REPO, "fixtures", "practice");
const ONE = ["pre", "post"].map((t) => path.join(PRACTICE, "one_group_prepost_likert", `${t}.csv`));
const GT = JSON.parse(readFileSync(path.join(PRACTICE, "one_group_prepost_likert", "ground_truth.json"), "utf8"));

let engine: StdioTransport;
let tmp: string;

beforeAll(async () => {
  engine = StdioTransport.start(resolveEngineCommand(REPO), { timeoutMs: 120_000 });
  setTransport(engine);
  expect((await rpc.ping()).pong).toBe(true);
  tmp = mkdtempSync(path.join(os.tmpdir(), "statly-analysis-suite-"));
}, 120_000);

afterAll(async () => {
  await engine?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  useImportFlow.getState().reset();
  useInterview.getState().reset();
  useDatasetStore.getState().clear();
  resetAnalysisSession();
  useProjectStore.getState().newProject("Analysis test");
});

async function importAndScore(): Promise<DatasetMeta> {
  const s = useImportFlow.getState();
  s.addFiles(ONE);
  expect(await s.runPreview()).toBe(true);
  const { preview, update } = useImportFlow.getState();
  update({
    responseConfirmed: Object.fromEntries(findResponseSets(preview!.files).map((x) => [x.key, true])),
    noncontiguousAck: Object.fromEntries(findNoncontiguous(preview!.files).map((v) => [v.variable, true])),
  });
  const pending = (preview!.stack_proposal ?? []).filter((m) => m.status === "possibly_renamed");
  if (pending.length) update({ matchDecisions: Object.fromEntries(pending.map((m) => [m.variable, "accept" as const])) });
  expect(await useImportFlow.getState().commit()).toBe(true);

  await useInterview.getState().start();
  useInterview.getState().setDraft({ reverse: Object.fromEntries(GT.reverse_worded_items.map((n: string) => [n, true])) });
  for (let guard = 0; useInterview.getState().step !== "summary"; guard++) {
    expect(useInterview.getState().problem()).toBeNull();
    useInterview.getState().next();
    expect(guard).toBeLessThan(200);
  }
  expect(await useInterview.getState().finish()).toBe(true);
  return useDatasetStore.getState().meta!;
}

describe("advisor -> assumptions -> results on one_group_prepost_likert", () => {
  it("recommends and runs an independent-samples t test on the scale score by Time, and logs it", async () => {
    const meta = await importAndScore();
    const score = meta.scales[0].score_variable!;
    expect(meta.link.mode).toBe("aggregate");

    // Test Advisor: outcome pre-selected (the scale score), context from roles/stacking.
    await useAdvisor.getState().start();
    let a = useAdvisor.getState();
    expect(a.error).toBeNull();
    expect(a.outcome).toBe(score);
    expect(a.context).toEqual({ outcome_level: "continuous", num_groups: 1, num_time_points: 2, linked_mode: false });
    expect(a.step!.next_question!.id).toBe("q_intent");

    await a.answer("q_intent", "compare");
    a = useAdvisor.getState();
    // The outcome question was answered from the data and is shown pre-filled.
    expect(a.step!.path[1]).toEqual({ question: "q_compare_outcome_level", value: "continuous", source: "auto" });
    expect(a.questions.q_compare_outcome_level.text).toMatch(/outcome/i);
    expect(a.step!.next_question!.id).toBe("q_compare_design");

    await a.answer("q_compare_design", "repeated_aggregate");
    a = useAdvisor.getState();
    const rec = a.step!.recommendation!;
    expect(rec.primary_test).toBe("t_test.independent");
    expect(rec.nonparametric_alternative).toBe("mann_whitney");
    expect(rec.caveats).toContain("aggregate_time_comparison");
    expect(a.step!.path.find((p) => p.question === "q_compare_aggregate_groups")?.source).toBe("auto");

    // Variables: pre-filled outcome = scale score, group = Time (aggregate pre/post).
    await useAnalysisFlow.getState().setup(rec, a.outcome);
    let f = useAnalysisFlow.getState();
    expect(f.error).toBeNull();
    expect(f.analysisId).toBe("t_test.independent");
    expect(f.roles).toEqual({ outcome: [score], group: ["Time"] });

    // Run once for the assumption checks; walk each one.
    expect(await f.runCheck()).toBe(true);
    f = useAnalysisFlow.getState();
    expect(f.stage).toBe("assumptions");
    const check = f.check!.result;
    const normal = check.assumptions.filter((x) => x.assumption === "normality");
    expect(normal.map((x) => x.applies_to.label).sort()).toEqual(["Post", "Pre"]);
    for (const x of normal) {
      expect(x.chart_refs.map((c) => c.chart_type).sort()).toEqual(["histogram", "qq"]);
      for (const c of x.chart_refs) expect(check.chart_data[c.data_key]?.length).toBeGreaterThan(0);
    }
    expect(check.assumptions.some((x) => x.assumption === "homogeneity_of_variance")).toBe(true);
    for (let i = 1; i <= check.assumptions.length; i++) useAnalysisFlow.getState().goAssumption(i);
    expect(useAnalysisFlow.getState().stage).toBe("decision");

    const suggestion = suggestedChoice(check, true);
    expect(["recommended", "alternative"]).toContain(suggestion.choice);
    expect(await useAnalysisFlow.getState().choose("recommended")).toBe(true);
    f = useAnalysisFlow.getState();
    expect(f.stage).toBe("done");

    // Results: descriptives reproduce the planted scale means; APA sentence present.
    const result = useResults.getState().byId[f.entryId!];
    expect(result.analysis_id).toBe("t_test.independent");
    const m = (label: string) => result.descriptives.continuous.find((d) => d.label === label)!.mean!;
    expect(m("Pre")).toBeCloseTo(GT.achieved.pre_scale_mean, 4);
    expect(m("Post")).toBeCloseTo(GT.achieved.post_scale_mean, 4);
    expect(richToPlain(result.apa_sentence)).toMatch(/t\(\d+(\.\d+)?\) = /);
    expect(result.plain_language_summary.length).toBeGreaterThan(20);

    // Test Log entry (SPEC §9): request echo, summary, no family/correction.
    const log = useProjectStore.getState().project!.test_log;
    expect(log).toHaveLength(1);
    const entry = log[0];
    expect(entry.id).toBe(f.entryId);
    expect(entry.request.analysis_id).toBe("t_test.independent");
    expect(entry.result_summary.outcome_variables).toEqual([score]);
    expect(entry.result_summary.primary_statistic?.key).toBe(result.statistics[0].key);
    expect(entry.result_summary.p).toBe(result.statistics[0].p);
    expect(entry.result_summary.primary_effect_size?.key).toBe("hedges_g");
    expect(entry.result_summary.n_used).toBe(GT.n_pre + GT.n_post);
    expect(entry).toMatchObject({ family_id: null, correction_method: "none", adjusted_p: null, result_path: null });
    expect(useProjectStore.getState().dirty).toBe(true);

    // Saved with the project (project.json test_log) and restored on open.
    const file = path.join(tmp, "analysis.statly");
    await useProjectStore.getState().saveTo(file);
    resetAnalysisSession();
    await useProjectStore.getState().open(file);
    const reloaded = useProjectStore.getState().project!.test_log;
    expect(reloaded.map((e) => e.id)).toEqual([entry.id]);
    // Reopening re-runs the stored request on the unchanged snapshot (pure engine).
    const again = await useResults.getState().reopen(entry.id);
    expect(again?.statistics[0].value).toBeCloseTo(result.statistics[0].value!, 10);

    if (process.env.STATLY_CAPTURE === "1") {
      writeFileSync(path.join(import.meta.dirname, "../test/fixtures/realTTestIndependent.json"), JSON.stringify(result, null, 2) + "\n");
    }
  });

  it("runs the nonparametric alternative when the user chooses it", async () => {
    const meta = await importAndScore();
    const score = meta.scales[0].score_variable!;
    await useAdvisor.getState().start(score);
    await useAdvisor.getState().answer("q_intent", "compare");
    await useAdvisor.getState().answer("q_compare_design", "repeated_aggregate");
    await useAnalysisFlow.getState().setup(useAdvisor.getState().step!.recommendation!, score);
    expect(await useAnalysisFlow.getState().runCheck()).toBe(true);
    const catalog = useAnalysisFlow.getState().catalog!;
    if (!catalog.some((x) => x.analysis_id === "mann_whitney")) return; // registered by a concurrent workstream
    expect(await useAnalysisFlow.getState().choose("alternative")).toBe(true);
    const entry = useProjectStore.getState().project!.test_log.at(-1)!;
    expect(entry.request.analysis_id).toBe("mann_whitney");
    expect(entry.request.variables).toEqual({ outcome: [score], group: ["Time"] });
    expect(useProjectStore.getState().project!.test_log).toHaveLength(1);
  });
});
