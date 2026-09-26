import { beforeEach, describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/contracts";
import exampleResult from "../../../contracts/examples/AnalysisResult.json";
import type { MockEngine } from "@/mocks/engine";
import { MOCK_TEST_LOG_PROJECT_PATH } from "@/mocks/shapes";
import { useFreshMock } from "@/test/mockTransport";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";
import { logRun, useTestLog } from "@/stores/testLog";

let engine: MockEngine;
const log = () => useProjectStore.getState().project!.test_log;
const byId = (id: string) => log().find((e) => e.id === id)!;

beforeEach(async () => {
  engine = useFreshMock();
  useResults.getState().clear();
  useTestLog.getState().reset();
  await useProjectStore.getState().open(MOCK_TEST_LOG_PROJECT_PATH);
});

describe("Test Log families", () => {
  it("groups two tests, applies Holm via corrections.adjust, and re-adjusts when the method changes", async () => {
    const id = await useTestLog.getState().saveFamily({ name: " Attitude items ", memberIds: ["req_item1", "req_item2"], method: "holm" });
    expect(id).toBe("fam_1");
    const p = useProjectStore.getState();
    expect(p.dirty).toBe(true);
    expect(p.project!.test_families).toEqual([{ id: "fam_1", name: "Attitude items" }]);
    expect(byId("req_item1")).toMatchObject({ family_id: "fam_1", correction_method: "holm", adjusted_p: expect.closeTo(0.024, 12) });
    expect(byId("req_item2").adjusted_p).toBeCloseTo(0.034, 12);
    expect(byId("req_scale")).toMatchObject({ family_id: null, correction_method: "none", adjusted_p: null });
    expect(engine.calls.filter((c) => c.method === "corrections.adjust")).toEqual([
      { method: "corrections.adjust", params: { p_values: [0.012, 0.034], method: "holm" } },
    ]);

    expect(await useTestLog.getState().setMethod("fam_1", "bonferroni")).toBe(true);
    expect(byId("req_item2")).toMatchObject({ correction_method: "bonferroni", adjusted_p: expect.closeTo(0.068, 12) });
    await useTestLog.getState().setMethod("fam_1", "fdr_bh");
    expect(byId("req_item1")).toMatchObject({ correction_method: "fdr_bh", adjusted_p: expect.closeTo(0.024, 12) });
    expect(byId("req_item2").adjusted_p).toBeCloseTo(0.034, 12);
  });

  it("keeps the latest method when changes overlap", async () => {
    await useTestLog.getState().saveFamily({ name: "F", memberIds: ["req_item1", "req_item2"], method: "holm" });
    await Promise.all([useTestLog.getState().setMethod("fam_1", "bonferroni"), useTestLog.getState().setMethod("fam_1", "fdr_bh")]);
    expect(byId("req_item1").correction_method).toBe("fdr_bh");
  });

  it("edits membership (removed tests are uncorrected) and ungroups", async () => {
    await useTestLog.getState().saveFamily({ name: "F", memberIds: ["req_item1", "req_item2", "req_scale"], method: "bonferroni" });
    expect(byId("req_scale").adjusted_p).toBeCloseTo(0.63, 12);
    await useTestLog.getState().saveFamily({ name: "F2", memberIds: ["req_item1", "req_scale"], method: "bonferroni" }, "fam_1");
    expect(byId("req_item2")).toMatchObject({ family_id: null, correction_method: "none", adjusted_p: null });
    expect(useProjectStore.getState().project!.test_families).toEqual([{ id: "fam_1", name: "F2" }]);
    useTestLog.getState().ungroup("fam_1");
    expect(useProjectStore.getState().project!.test_families).toEqual([]);
    expect(log().every((e) => e.family_id === null && e.adjusted_p === null)).toBe(true);
  });

  it("refuses post hoc tests, fewer than two tests, and a blank name", async () => {
    expect(await useTestLog.getState().saveFamily({ name: "F", memberIds: ["req_item1", "req_tukey"], method: "holm" })).toBeNull();
    expect(useTestLog.getState().error).toMatch(/at least two/);
    expect(await useTestLog.getState().saveFamily({ name: "  ", memberIds: ["req_item1", "req_item2"], method: "holm" })).toBeNull();
    expect(byId("req_tukey").family_id).toBeNull();
  });

  it("persists families and adjusted p across save and reopen; reopens results without re-running", async () => {
    await useTestLog.getState().saveFamily({ name: "Items", memberIds: ["req_item1", "req_item2"], method: "holm" });
    await useProjectStore.getState().saveTo("/mock/projects/Families.statly");
    useProjectStore.getState().close();
    useResults.getState().clear();
    await useProjectStore.getState().open("/mock/projects/Families.statly");
    expect(byId("req_item1")).toMatchObject({ family_id: "fam_1", correction_method: "holm", result_path: "results/req_item1.json" });
    expect(byId("req_item1").adjusted_p).toBeCloseTo(0.024, 12);
    engine.calls.length = 0;
    const r = await useResults.getState().reopen("req_item2");
    expect(r?.analysis_id).toBe("t_test.independent");
    expect(engine.calls.map((c) => c.method)).toEqual(["results.get"]);
  });

  it("logRun hands the full result to the engine so save writes result_path", async () => {
    const e0 = byId("req_item1");
    const request = { ...e0.request, request_id: "req_new" };
    const entry = logRun(request, structuredClone(exampleResult as unknown as AnalysisResult), "Independent-samples t test");
    expect(entry.result_path).toBeNull();
    await useProjectStore.getState().saveTo(MOCK_TEST_LOG_PROJECT_PATH);
    expect(byId("req_new").result_path).toBe("results/req_new.json");
  });
});
