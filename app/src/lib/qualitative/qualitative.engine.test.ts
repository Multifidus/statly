// @vitest-environment node
/**
 * Real-engine test for the qualitative module (SPEC §11.1, Phase 9): import the messy Qualtrics
 * export, tag three Q10 responses, summarize by Q6, make yes/no variables, export, save, and
 * reopen in a fresh engine with the codebook, tags, and variables intact.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findNoncontiguous, findResponseSets } from "@/lib/importLogic";
import { qualRpc } from "@/lib/qualitative/api";
import { rpc, setTransport } from "@/lib/rpc";
import { resolveEngineCommand, StdioTransport } from "@/lib/transports/stdio";
import { useDatasetStore } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";
import { useProjectStore } from "@/stores/project";
import { useQualitative } from "@/stores/qualitative";

const REPO = path.resolve(import.meta.dirname, "../../../..");
const MESSY = path.join(REPO, "fixtures", "practice", "messy_qualtrics", "messy_3header.csv");

let engine: StdioTransport;
let tmp: string;
const start = () => StdioTransport.start(resolveEngineCommand(REPO), { timeoutMs: 120_000 });
const q = () => useQualitative.getState();

beforeAll(async () => {
  engine = start();
  setTransport(engine);
  expect((await rpc.ping()).pong).toBe(true);
  tmp = mkdtempSync(path.join(os.tmpdir(), "statly-qual-"));
}, 120_000);

afterAll(async () => {
  await engine?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("qualitative coding on messy_qualtrics Q10", () => {
  it("tags, summarizes, makes yes/no variables, exports, and survives save/reopen", async () => {
    useDatasetStore.getState().clear();
    useProjectStore.getState().newProject("Coded survey");
    const s = useImportFlow.getState();
    s.reset();
    s.addFiles([MESSY]);
    expect(await s.runPreview()).toBe(true);
    const { preview, update } = useImportFlow.getState();
    update({
      responseConfirmed: Object.fromEntries(findResponseSets(preview!.files).map((x) => [x.key, true])),
      noncontiguousAck: Object.fromEntries(findNoncontiguous(preview!.files).map((v) => [v.variable, true])),
    });
    expect(await useImportFlow.getState().commit()).toBe(true);
    const meta = useDatasetStore.getState().meta!;

    q().reset();
    await q().init(meta);
    await q().setVariable("Q10");
    expect(q().error).toBeNull();
    // A few Q10 responses are intentionally blank, so not every kept respondent
    // answered it; `total` (no search/filter applied) should equal the count of
    // non-blank answers, which is strictly fewer than the row count.
    expect(q().total).toBe(q().totalResponses);
    expect(q().totalResponses).toBeGreaterThan(0);
    expect(q().totalResponses).toBeLessThan(meta.n_rows);
    const totalResponses = q().totalResponses;

    expect(await q().saveTag({ name: "Pacing", definition: "Talks about the speed of the course." })).toBe(true);
    expect(await q().saveTag({ name: "Recommends" })).toBe(true);
    const [pacing, rec] = q().codebook.tags;
    await q().toggleTag(0, pacing.id);
    await q().toggleTag(1, pacing.id);
    await q().toggleTag(1, rec.id);
    await q().toggleTag(2, rec.id);
    const tagged = [0, 1, 2].map((i) => q().items[i].row_id);

    await q().setSearch("pacing");
    const first = q().items[0];
    expect(first.text.slice(first.matches[0][0], first.matches[0][1])).toBe("pacing");
    await q().setSearch("");

    await q().loadSummary("Q6");
    const sum = q().summary!;
    expect(sum.overall.map((c) => c.count)).toEqual([2, 2]);
    expect(sum.n_coded).toBe(3);
    expect(sum.groups.reduce((n, g) => n + g.n_responses, 0) + sum.n_missing_group).toBe(sum.n_responses);
    expect(sum.groups.reduce((n, g) => n + g.counts[0].count, 0)).toBeLessThanOrEqual(2);

    const created = await q().makeVariables();
    expect(created!.map((c) => [c.variable, c.n_yes])).toEqual([["Q10_pacing", 2], ["Q10_recommends", 2]]);
    const after = useDatasetStore.getState().meta!;
    expect(after.snapshot_id).not.toBe(meta.snapshot_id);
    const rows = await rpc.rows({ dataset_id: after.dataset_id, snapshot_id: after.snapshot_id, offset: 0, limit: 3, columns: ["Q10_pacing", "Q10_recommends"], sort: null });
    expect(rows.rows).toEqual([[1, 0], [1, 1], [0, 1]]);

    const xlsx = path.join(tmp, "coded.xlsx");
    const exp = await qualRpc.exportQualitative({ dataset_id: after.dataset_id, variable: "Q10", kind: "responses", format: "xlsx", path: xlsx });
    expect(exp.n_responses).toBe(totalResponses);
    expect(existsSync(xlsx)).toBe(true);

    const file = path.join(tmp, "coded.statly");
    await useProjectStore.getState().saveTo(file);
    expect(useProjectStore.getState().project!.tag_codebook!.applications).toHaveLength(3);

    // Fresh engine process: reopen and find everything.
    await engine.close();
    engine = start();
    setTransport(engine);
    useDatasetStore.getState().clear();
    q().reset();
    await useProjectStore.getState().open(file);
    const reopened = useDatasetStore.getState().meta!;
    expect(reopened.snapshot_id).toBe(after.snapshot_id);
    expect(reopened.variables.some((v) => v.name === "Q10_pacing")).toBe(true);
    await q().init(reopened);
    await q().setVariable("Q10");
    expect(q().codebook.tags.map((t) => t.name)).toEqual(["Pacing", "Recommends"]);
    await q().setTagFilter(pacing.id);
    expect(Object.values(q().items).map((i) => i.row_id)).toEqual(tagged.slice(0, 2));
    await q().loadSummary(null);
    expect(q().summary!.overall.map((c) => c.count)).toEqual([2, 2]);
  });
});
