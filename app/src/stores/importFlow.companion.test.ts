import { beforeEach, describe, expect, it } from "vitest";
import { blockingReason, buildImportParams, companionView } from "@/lib/importLogic";
import { useDatasetStore } from "@/stores/dataset";
import { stepsFor, useImportFlow } from "@/stores/importFlow";
import { LINKED, MESSY, MESSY_TEXT, THREE, useFreshMock } from "@/test/mockTransport";

beforeEach(() => {
  useFreshMock();
});

async function preview(paths: string[]) {
  useImportFlow.getState().addFiles(paths);
  expect(await useImportFlow.getState().runPreview()).toBe(true);
  return useImportFlow.getState();
}

const AGREE = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];

describe("numbers + words companion pair", () => {
  it("imports the pair as one labelled dataset instead of two time points", async () => {
    // Words file first: the engine, not the pick order, decides which file holds the numbers.
    const s = await preview([MESSY_TEXT, MESSY]);
    expect(s.preview!.files.map((f) => f.name)).toEqual(["messy_3header.csv"]);
    expect(s.labelsFile?.name).toBe("messy_text_choices.csv");
    expect(s.preview!.stack_proposal).toBeNull();
    expect(stepsFor(s.preview!.files.length)).not.toContain("stack");
    expect(s.preview!.files[0].issues[0].message).toMatch(/keep the numbers and attach the words as labels/);

    const q5 = s.preview!.files[0].proposed_variables.find((v) => v.name === "Q5_1")!;
    expect(q5.value_labels.map((l) => l.label)).toEqual(AGREE);

    const params = buildImportParams(s.preview!, s.decisions!);
    expect(params.stack).toBeNull();
    expect(params.files.map((f) => f.file_id)).toEqual([s.preview!.companion_pair!.values_file_id]);
    expect(params.companion).toEqual({
      values_file_id: s.preview!.companion_pair!.values_file_id,
      labels_file_id: s.preview!.companion_pair!.labels_file_id,
    });
    // No answer-order question (the words come from the survey); only the Q6 codes that skip values need a look.
    expect(blockingReason("cleanup", s.preview, s.decisions, 1)).toMatch(/unusual answer codes/); // Q6 codes skip values
    s.update({ noncontiguousAck: { Q6: true } });
    expect(blockingReason("cleanup", useImportFlow.getState().preview, useImportFlow.getState().decisions, 1)).toBeNull();

    expect(await useImportFlow.getState().commit()).toBe(true);
    const meta = useDatasetStore.getState().meta!;
    expect(meta.stacking).toBeNull();
    expect(meta.variables.some((v) => v.name === "Time")).toBe(false);
    const v = meta.variables.find((x) => x.name === "Q5_1")!;
    expect(v.dtype).toBe("integer");
    expect(v.level).toBe("ordinal");
    expect(v.value_labels).toEqual(AGREE.map((label, i) => ({ value: i + 1, label })));
    expect(meta.import_log.files.map((f) => [f.name, f.role ?? "data"])).toEqual([
      ["messy_3header.csv", "data"],
      ["messy_text_choices.csv", "value_labels"],
    ]);
  });

  it("leaves genuine time points to the stacking steps", async () => {
    for (const paths of [THREE, LINKED]) {
      useFreshMock();
      useImportFlow.getState().reset();
      const s = await preview(paths);
      expect(s.labelsFile).toBeNull();
      expect(s.preview!.companion_pair ?? null).toBeNull();
      expect(s.preview!.files).toHaveLength(paths.length);
      expect(buildImportParams(s.preview!, s.decisions!).companion).toBeUndefined();
    }
  });

  it("companionView passes a preview without a pair through untouched", async () => {
    const s = await preview([MESSY]);
    expect(companionView(s.preview!).preview).toBe(s.preview);
  });
});
