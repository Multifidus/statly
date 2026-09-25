/**
 * Phase 2 RPC methods (docs/PROTOCOL.md "Phase 2 methods") over MockEngine: variable edits,
 * scale scoring, answer-key scoring, computed variables, and undo/redo history.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { EngineError } from "@/lib/engine";
import { rpc } from "@/lib/rpc";
import { useFreshMock, THREE } from "@/test/mockTransport";
import { useDatasetStore } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";

const MESSY = "/mock/fixtures/messy_qualtrics/messy_3header.csv";

/** Import a single file with default decisions (the mock engine doesn't gate on cleanup acks). */
async function importFile(path: string): Promise<string> {
  const flow = useImportFlow.getState();
  flow.addFiles([path]);
  expect(await useImportFlow.getState().runPreview()).toBe(true);
  expect(await useImportFlow.getState().commit()).toBe(true);
  return useDatasetStore.getState().meta!.dataset_id;
}

async function expectRpcError(p: Promise<unknown>, messageSubstring: string): Promise<EngineError> {
  try {
    await p;
  } catch (e) {
    const err = e as EngineError;
    expect(err.kind).toBe("rpc");
    if (err.kind === "rpc") expect(err.message).toContain(messageSubstring);
    return err;
  }
  throw new Error("expected rpc call to reject");
}

beforeEach(() => {
  useFreshMock();
});

describe("variables.update + history/restore_snapshot", () => {
  it("edits a variable, records history, and undo/redo round-trips", async () => {
    const datasetId = await importFile(MESSY);
    const before = await rpc.history({ dataset_id: datasetId });
    expect(before.entries).toHaveLength(1);
    expect(before.entries[0].label).toBe("Imported data");
    const originalSnapshot = before.current_snapshot_id;
    const originalLabel = useDatasetStore.getState().meta!.variables.find((v) => v.name === "Q1")!.label;

    const res = await rpc.updateVariables({ dataset_id: datasetId, updates: [{ name: "Q1", label: "Consent question" }] });
    expect(res.warnings).toEqual([]);
    expect(res.dataset_meta.variables.find((v) => v.name === "Q1")?.label).toBe("Consent question");
    expect(res.dataset_meta.snapshot_id).not.toBe(originalSnapshot);

    const after = await rpc.history({ dataset_id: datasetId });
    expect(after.entries).toHaveLength(2);
    expect(after.entries[1].label).toBe("Changed label of Q1");
    expect(after.cursor).toBe(1);

    // Undo: restore the original snapshot.
    const undone = await rpc.restoreSnapshot({ dataset_id: datasetId, snapshot_id: originalSnapshot });
    expect(undone.dataset_meta.variables.find((v) => v.name === "Q1")?.label).toBe(originalLabel);
    const afterUndo = await rpc.history({ dataset_id: datasetId });
    expect(afterUndo.cursor).toBe(0);

    // Redo: restore the edited snapshot.
    const redone = await rpc.restoreSnapshot({ dataset_id: datasetId, snapshot_id: res.dataset_meta.snapshot_id });
    expect(redone.dataset_meta.variables.find((v) => v.name === "Q1")?.label).toBe("Consent question");
  });

  it("a no-op edit adds no history entry", async () => {
    const datasetId = await importFile(MESSY);
    const meta = useDatasetStore.getState().meta!;
    const q1 = meta.variables.find((v) => v.name === "Q1")!;
    await rpc.updateVariables({ dataset_id: datasetId, updates: [{ name: "Q1", role: q1.role }] });
    const h = await rpc.history({ dataset_id: datasetId });
    expect(h.entries).toHaveLength(1);
  });

  it("rejects a stale snapshot_id", async () => {
    const datasetId = await importFile(MESSY);
    await expectRpcError(
      rpc.updateVariables({ dataset_id: datasetId, snapshot_id: "not-current", updates: [{ name: "Q1", label: "x" }] }),
      "changed",
    );
  });
});

describe("scales.upsert", () => {
  it("scores the Q5 scale and updates the score when Q5_4 is reverse-coded", async () => {
    const datasetId = await importFile(MESSY);
    const up = await rpc.upsertScale({
      dataset_id: datasetId,
      scale: { name: "Q5 scale", items: ["Q5_1", "Q5_2", "Q5_3", "Q5_4", "Q5_5", "Q5_6"], scoring_method: "mean" },
    });
    const scale = up.dataset_meta.scales.find((s) => s.name === "Q5 scale")!;
    expect(scale.score_variable).toBeTruthy();
    const scoreVar = scale.score_variable!;
    expect(up.dataset_meta.variables.find((v) => v.name === scoreVar)?.computed?.op).toBe("scale_mean");

    const before = await rpc.rows({ dataset_id: datasetId, snapshot_id: null, columns: [scoreVar], offset: 0, limit: 20, sort: null });

    const rev = await rpc.updateVariables({ dataset_id: datasetId, updates: [{ name: "Q5_4", reverse_coded: true }] });
    expect(rev.dataset_meta.variables.find((v) => v.name === "Q5_4")?.reverse_coded).toBe(true);

    const after = await rpc.rows({ dataset_id: datasetId, snapshot_id: null, columns: [scoreVar], offset: 0, limit: 20, sort: null });
    expect(after.rows).not.toEqual(before.rows);
  });

  it("rejects fewer than two items", async () => {
    const datasetId = await importFile(MESSY);
    await expectRpcError(
      rpc.upsertScale({ dataset_id: datasetId, scale: { name: "One item", items: ["Q5_1"], scoring_method: "mean" } }),
      "two items",
    );
  });
});

describe("items.score", () => {
  it("scores test items against an answer key and builds a total", async () => {
    const datasetId = await importFile(THREE[0]);
    const key = await rpc.parseAnswerKey({ path: "/mock/fixtures/answer_key.csv" });
    expect(key.entries.length).toBe(20);

    const res = await rpc.scoreItems({ dataset_id: datasetId, key: key.entries });
    const names = res.dataset_meta.variables.map((v) => v.name);
    expect(names).toContain("Q4_1_correct");
    expect(names).toContain("Q4_20_correct");
    expect(names).toContain("Q4_total");

    const correctVar = res.dataset_meta.variables.find((v) => v.name === "Q4_1_correct")!;
    expect(correctVar.value_labels).toEqual([
      { value: 0, label: "Incorrect" },
      { value: 1, label: "Correct" },
    ]);
    const total = res.dataset_meta.variables.find((v) => v.name === "Q4_total")!;
    expect(total.computed).toEqual({
      op: "scale_sum",
      items: Array.from({ length: 20 }, (_, i) => `Q4_${i + 1}_correct`),
      min_items: 1,
      scale_id: null,
    });
  });
});

describe("computed.preview / computed.add / computed.remove", () => {
  it("previews without committing, then adds and removes the same definition", async () => {
    const datasetId = await importFile(MESSY);
    const definition = { op: "scale_mean" as const, items: ["Q5_1", "Q5_2"] as [string, string], min_items: null, scale_id: null };

    const before = await rpc.history({ dataset_id: datasetId });
    const preview = await rpc.previewComputed({ dataset_id: datasetId, definition });
    expect(preview.values.length).toBeLessThanOrEqual(10);
    expect(preview.dtype).toBe("float");
    const afterPreview = await rpc.history({ dataset_id: datasetId });
    expect(afterPreview.entries).toHaveLength(before.entries.length); // no commit

    const added = await rpc.addComputed({ dataset_id: datasetId, name: "Q5_pair_avg", definition });
    const addedVar = added.dataset_meta.variables.find((v) => v.name === "Q5_pair_avg")!;
    expect(addedVar.computed?.op).toBe("scale_mean");
    expect(addedVar.dtype).toBe("float");

    const removed = await rpc.removeComputed({ dataset_id: datasetId, name: "Q5_pair_avg" });
    expect(removed.dataset_meta.variables.some((v) => v.name === "Q5_pair_avg")).toBe(false);
  });
});

describe("computed operand time_level without linking", () => {
  it("rejects a time-level operand when the dataset isn't linked", async () => {
    const datasetId = await importFile(MESSY);
    await expectRpcError(
      rpc.previewComputed({
        dataset_id: datasetId,
        definition: {
          op: "difference",
          minuend: { variable: "Q5_1", time_level: "Post" },
          subtrahend: { variable: "Q5_2", time_level: "Pre" },
        },
      }),
      "link people across time",
    );
  });
});
