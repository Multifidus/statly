// @vitest-environment node
/**
 * Real-engine test for the Test Log families workflow (SPEC §9, Phase 6): log three t tests on the
 * practice data, group two into a family, apply Holm (engine corrections.adjust), save, reopen in a
 * fresh engine, and see the adjusted p-values and the stored full results (results.get, no re-run).
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AnalysisRequest } from "@/contracts";
import { findNoncontiguous, findResponseSets } from "@/lib/importLogic";
import { newRequestId } from "@/lib/resultSummary";
import { rpc, setTransport } from "@/lib/rpc";
import { suggestFamilies } from "@/lib/testFamilies";
import { resolveEngineCommand, StdioTransport } from "@/lib/transports/stdio";
import { resetAnalysisSession } from "@/lib/analysisSession";
import { useDatasetStore } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";
import { logRun, useTestLog } from "@/stores/testLog";

const REPO = path.resolve(import.meta.dirname, "../../..");
const ONE = ["pre", "post"].map((t) => path.join(REPO, "fixtures", "practice", "one_group_prepost_likert", `${t}.csv`));

let engine: StdioTransport;
let tmp: string;
const start = () => StdioTransport.start(resolveEngineCommand(REPO), { timeoutMs: 120_000 });

beforeAll(async () => {
  engine = start();
  setTransport(engine);
  expect((await rpc.ping()).pong).toBe(true);
  tmp = mkdtempSync(path.join(os.tmpdir(), "statly-testlog-"));
}, 120_000);

afterAll(async () => {
  await engine?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function holm(p: number[]): number[] {
  const o = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  const out = new Array<number>(p.length);
  let acc = 0;
  o.forEach((i, k) => {
    acc = Math.max(acc, (p.length - k) * p[i]);
    out[i] = Math.min(1, acc);
  });
  return out;
}

describe("Test Log families on one_group_prepost_likert", () => {
  it("logs three t tests, groups two with Holm, and keeps the adjusted p across save/reopen", async () => {
    useDatasetStore.getState().clear();
    resetAnalysisSession();
    useProjectStore.getState().newProject("Families");
    const s = useImportFlow.getState();
    s.reset();
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
    const meta = useDatasetStore.getState().meta!;

    // Three independent-samples t tests: items Q3_1..Q3_3 by Time.
    const ids: string[] = [];
    for (const item of ["Q3_1", "Q3_2", "Q3_3"]) {
      const request: AnalysisRequest = {
        schema_version: 1, request_id: newRequestId(), analysis_id: "t_test.independent", dataset_id: meta.dataset_id,
        snapshot_id: meta.snapshot_id, variables: { outcome: [item], group: ["Time"] }, subset: [], options: {},
        corrections: [], alpha: 0.05, tails: "two_sided", ci_level: 0.95,
      };
      const result = await rpc.analysisRun(request);
      ids.push(logRun(request, result, "Independent-samples t test").id);
    }
    const log0 = useProjectStore.getState().project!.test_log;
    expect(log0.every((e) => e.result_summary.p !== null && e.family_id === null)).toBe(true);

    // Statly suggests (never applies) a family: same analysis on the same snapshot.
    const [suggestion] = suggestFamilies(log0);
    expect(suggestion).toMatchObject({ reason: "analysis", memberIds: ids });

    // The user groups the first two and chooses Holm.
    const fam = await useTestLog.getState().saveFamily({ name: "First items", memberIds: ids.slice(0, 2), method: "holm" });
    expect(fam).toBe("fam_1");
    const raw = ids.slice(0, 2).map((id) => log0.find((e) => e.id === id)!.result_summary.p!);
    const want = holm(raw);
    const adjustedNow = ids.slice(0, 2).map((id) => useProjectStore.getState().project!.test_log.find((e) => e.id === id)!.adjusted_p);
    adjustedNow.forEach((a, i) => expect(a).toBeCloseTo(want[i], 12));

    const file = path.join(tmp, "families.statly");
    await useProjectStore.getState().saveTo(file);
    expect(useProjectStore.getState().project!.test_log.map((e) => e.result_path)).toEqual(ids.map((id) => `results/${id}.json`));

    // Reopen in a fresh engine process: families, adjusted p and full results come from the file.
    await engine.close();
    engine = start();
    setTransport(engine);
    useProjectStore.getState().close();
    useResults.getState().clear();
    const project = await useProjectStore.getState().open(file);
    expect(project.test_families).toEqual([{ id: "fam_1", name: "First items" }]);
    const reopened = ids.map((id) => project.test_log.find((e) => e.id === id)!);
    expect(reopened.map((e) => e.family_id)).toEqual(["fam_1", "fam_1", null]);
    expect(reopened.map((e) => e.correction_method)).toEqual(["holm", "holm", "none"]);
    reopened.slice(0, 2).forEach((e, i) => expect(e.adjusted_p).toBeCloseTo(want[i], 12));
    expect(reopened[2].adjusted_p).toBeNull();

    const stored = await rpc.resultsGet({ request_id: ids[0] });
    expect(stored.result.analysis_id).toBe("t_test.independent");
    expect(stored.result.statistics[0].p).toBeCloseTo(raw[0], 12);
    const viaStore = await useResults.getState().reopen(ids[1]);
    expect(viaStore?.statistics[0].p).toBeCloseTo(raw[1], 12);
  }, 180_000);
});
