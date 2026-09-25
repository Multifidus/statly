import { beforeEach, describe, expect, it } from "vitest";
import {
  blockingReason,
  buildImportParams,
  defaultTimeLabel,
  findNoncontiguous,
  findResponseSets,
  resolveMatches,
  suggestOrder,
} from "@/lib/importLogic";
import type { MockEngine } from "@/mocks/engine";
import { useDatasetStore } from "@/stores/dataset";
import { stepsFor, useImportFlow } from "@/stores/importFlow";
import { useProjectStore } from "@/stores/project";
import { LINKED, MESSY, MESSY_TEXT, THREE, useFreshMock } from "@/test/mockTransport";

let engine: MockEngine;
beforeEach(() => {
  engine = useFreshMock();
});

async function preview(paths: string[]) {
  useImportFlow.getState().addFiles(paths);
  expect(await useImportFlow.getState().runPreview()).toBe(true);
  return useImportFlow.getState();
}

describe("import logic helpers", () => {
  it("guesses time labels from file names", () => {
    expect(defaultTimeLabel("pre.csv", 0)).toBe("Pre");
    expect(defaultTimeLabel("Post survey.csv", 1)).toBe("Post");
    expect(defaultTimeLabel("followup.csv", 2)).toBe("Follow-up");
    expect(defaultTimeLabel("survey_preview.csv", 0)).toBe("Time 1");
    expect(defaultTimeLabel("data.xlsx", 3)).toBe("Time 4");
  });

  it("orders common response scales low to high", () => {
    expect(suggestOrder(["Agree", "Disagree", "Neutral", "Strongly agree", "Strongly disagree"])).toEqual([
      "Strongly disagree",
      "Disagree",
      "Neutral",
      "Agree",
      "Strongly agree",
    ]);
    expect(suggestOrder(["b", "a"])).toEqual(["b", "a"]);
  });

  it("resolveMatches splits 'keep separate' columns with unique names", () => {
    const out = resolveMatches(
      [
        { variable: "SC0", status: "possibly_renamed", similarity: 1, columns: [{ file_id: "a", column: "SC0" }, { file_id: "b", column: "SC1" }] },
        { variable: "SC1", status: "unmatched", similarity: null, columns: [{ file_id: "c", column: "SC1" }] },
      ],
      { SC0: "separate" },
    );
    expect(out.map((m) => [m.variable, m.status])).toEqual([
      ["SC0", "unmatched"],
      ["SC1_2", "unmatched"],
      ["SC1", "unmatched"],
    ]);
  });
});

it("resolveMatches keeps same-named columns together when separating a rename", () => {
  const out = resolveMatches(
    [
      {
        variable: "SC0",
        status: "possibly_renamed",
        similarity: 1,
        columns: [
          { file_id: "pre", column: "SC0" },
          { file_id: "post", column: "SC0" },
          { file_id: "fu", column: "SC1" },
        ],
      },
    ],
    { SC0: "separate" },
  );
  expect(out).toEqual([
    { variable: "SC0", status: "unmatched", similarity: null, columns: [{ file_id: "pre", column: "SC0" }, { file_id: "post", column: "SC0" }] },
    { variable: "SC1", status: "unmatched", similarity: null, columns: [{ file_id: "fu", column: "SC1" }] },
  ]);
});

describe("importFlow store (single messy Qualtrics file)", () => {
  it("previews with safe defaults: PII dropped, status filter on, unfinished off, metadata hidden", async () => {
    const s = await preview([MESSY]);
    expect(stepsFor(1)).toEqual(["files", "detect", "cleanup", "summary"]);
    const f = s.preview!.files[0];
    expect(f.qualtrics).toMatchObject({ detected: true, header_rows: 3 });
    const d = s.decisions!;
    expect(d.dropColumns.sort()).toEqual(
      ["IPAddress", "LocationLatitude", "LocationLongitude", "RecipientEmail", "RecipientFirstName", "RecipientLastName"].sort(),
    );
    const status = f.suggested_row_filters.find((x) => x.kind === "exclude_values")!;
    const unfinished = f.suggested_row_filters.find((x) => x.kind === "exclude_unfinished")!;
    expect(status.rows_removed).toBe(5);
    expect(unfinished.rows_removed).toBe(8);
    expect(d.enabledFilters[status.id]).toBe(true);
    expect(d.enabledFilters[unfinished.id]).toBe(false);
    expect(d.hideMetadata).toBe(true);
    expect(findNoncontiguous(s.preview!.files)).toEqual([{ variable: "Q6", codes: [1, 2, 4, 5, 7] }]);
  });

  it("blocks the clean-up step until the unusual Q6 codes are acknowledged", async () => {
    const s = await preview([MESSY]);
    expect(blockingReason("cleanup", s.preview, s.decisions, 1)).toMatch(/unusual answer codes/);
    s.update({ noncontiguousAck: { Q6: true } });
    const t = useImportFlow.getState();
    expect(blockingReason("cleanup", t.preview, t.decisions, 1)).toBeNull();
    t.update({ progressThreshold: 0 });
    const u = useImportFlow.getState();
    expect(blockingReason("cleanup", u.preview, u.decisions, 1)).toMatch(/cutoff/);
  });

  it("commits: 113 read, 5 preview/spam removed, PII gone, project dirty", async () => {
    const s = await preview([MESSY]);
    s.update({ noncontiguousAck: { Q6: true } });
    expect(await useImportFlow.getState().commit()).toBe(true);
    const meta = useDatasetStore.getState().meta!;
    expect(meta.n_rows).toBe(108);
    expect(meta.variables.some((v) => v.name === "IPAddress")).toBe(false);
    expect(meta.import_log.dropped_columns).toHaveLength(6);
    expect(meta.import_log.row_filters[0].rows_removed).toBe(5);
    expect(useDatasetStore.getState().showMetadata).toBe(false);
    expect(useProjectStore.getState().dirty).toBe(true);
    const q5 = meta.missing_summary.find((m) => m.variable === "Q5_1")!;
    expect(q5.n_missing_coded).toBeGreaterThan(0);
  });

  it("text choices: requires order confirmation and sends numeric coding", async () => {
    const s = await preview([MESSY_TEXT]);
    const sets = findResponseSets(s.preview!.files);
    expect(sets).toHaveLength(1);
    expect(sets[0].variables).toEqual(["Q5_1", "Q5_2", "Q5_3", "Q5_4", "Q5_5", "Q5_6", "Q6"]);
    expect(blockingReason("cleanup", s.preview, s.decisions, 1)).toMatch(/order/);
    s.update({ responseConfirmed: { [sets[0].key]: true } });
    const params = buildImportParams(useImportFlow.getState().preview!, useImportFlow.getState().decisions!);
    const q6 = params.variables.find((v) => v.name === "Q6")!;
    expect(q6.value_labels.map((l) => [l.value, l.label])).toEqual([
      [1, "Strongly disagree"],
      [2, "Disagree"],
      [3, "Neutral"],
      [4, "Agree"],
      [5, "Strongly agree"],
    ]);
    expect(q6.response_range).toEqual({ min: 1, max: 5 });
    expect(params.variables.some((v) => v.name === "IPAddress")).toBe(false);
    expect(await useImportFlow.getState().commit()).toBe(true);
    const rows = engine.rows({ dataset_id: useDatasetStore.getState().meta!.dataset_id, snapshot_id: null, offset: 0, limit: 5, columns: ["Q6"], sort: null });
    expect(rows.rows.every(([v]) => v === -99 || (typeof v === "number" && v >= 1 && v <= 5))).toBe(true);
  });

  it("surfaces engine errors in plain language", async () => {
    useImportFlow.getState().addFiles(["/nowhere/unknown.sav"]);
    expect(await useImportFlow.getState().runPreview()).toBe(false);
    expect(useImportFlow.getState().error).toMatch(/couldn't read that file/);
  });
});

describe("importFlow store (multi-file)", () => {
  it("stacks three files after the renamed column is resolved", async () => {
    const s = await preview(THREE);
    expect(stepsFor(3)).toContain("stack");
    expect(s.decisions!.timeLabels).toEqual(
      Object.fromEntries(s.preview!.files.map((f, i) => [f.file_id, ["Pre", "Post", "Follow-up"][i]])),
    );
    const renamed = s.preview!.stack_proposal!.filter((m) => m.status === "possibly_renamed");
    expect(renamed.map((m) => m.variable)).toEqual(["SC0"]);
    expect(blockingReason("stack", s.preview, s.decisions, 3)).toMatch(/possibly renamed/);
    s.update({ matchDecisions: { SC0: "accept" } });
    const params = buildImportParams(useImportFlow.getState().preview!, useImportFlow.getState().decisions!);
    expect(params.stack!.levels.map((l) => l.label)).toEqual(["Pre", "Post", "Follow-up"]);
    expect(params.files.map((f) => f.time_label)).toEqual(["Pre", "Post", "Follow-up"]);
    expect(await useImportFlow.getState().commit()).toBe(true);
    const meta = useDatasetStore.getState().meta!;
    expect(meta.stacking!.levels).toHaveLength(3);
    expect(meta.variables[0]).toMatchObject({ name: "Time", role: "time" });
  });

  it("rejects duplicate time labels", async () => {
    const s = await preview(LINKED);
    const [a, b] = s.preview!.files.map((f) => f.file_id);
    s.update({ timeLabels: { [a]: "Pre", [b]: "pre" } });
    const t = useImportFlow.getState();
    expect(blockingReason("stack", t.preview, t.decisions, 2)).toMatch(/different/);
  });

  it("links by ID after import and reports matched / unmatched / duplicate", async () => {
    const s = await preview(LINKED);
    s.update({ linkMode: "linked", idVariable: null });
    let t = useImportFlow.getState();
    expect(blockingReason("link", t.preview, t.decisions, 2)).toMatch(/identifies/);
    t.update({ idVariable: "Q1" });
    t = useImportFlow.getState();
    expect(blockingReason("link", t.preview, t.decisions, 2)).toBeNull();
    expect(await t.commit()).toBe(true);
    const report = useImportFlow.getState().result!.linkReport!;
    expect(report.counts).toEqual({ matched: 75, unmatched: 9, duplicate: 2 });
    expect(useDatasetStore.getState().meta!.link).toMatchObject({ mode: "linked", id_variable: "Q1" });
  });

  it("won't link on a column that is being dropped as PII", async () => {
    const s = await preview(LINKED);
    s.update({ linkMode: "linked", idVariable: "RecipientEmail" });
    const t = useImportFlow.getState();
    expect(blockingReason("link", t.preview, t.decisions, 2)).toMatch(/removed/);
  });
});
