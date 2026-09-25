// @vitest-environment node
/**
 * Real-engine integration suite (`npm run test:engine`). Drives the same zustand stores the
 * wizard uses (importFlow -> importLogic.buildImportParams -> rpc) against a real engine process
 * over NDJSON stdio, so every request is exactly what the app sends. Point it at a packaged
 * binary with STATLY_ENGINE_BIN to prove the PyInstaller bundle (pyarrow, openpyxl, ...).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CellValue, DatasetMeta, FilePreview } from "@/contracts";
import { blockingReason, buildImportParams, findNoncontiguous, findResponseSets } from "@/lib/importLogic";
import { rpc, setTransport } from "@/lib/rpc";
import { resolveEngineCommand, StdioTransport } from "@/lib/transports/stdio";
import { useDatasetStore } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";
import { useProjectStore } from "@/stores/project";

const REPO = path.resolve(import.meta.dirname, "../../..");
const PRACTICE = path.join(REPO, "fixtures", "practice");
const MESSY_DIR = path.join(PRACTICE, "messy_qualtrics");
const MESSY = path.join(MESSY_DIR, "messy_3header.csv");
const MESSY_TEXT = path.join(MESSY_DIR, "messy_text_choices.csv");
const MESSY_XLSX = path.join(MESSY_DIR, "messy.xlsx");
const THREE = ["pre", "post", "followup"].map((t) => path.join(PRACTICE, "three_groups_prepost_followup", `${t}.csv`));
const LINKED = ["pre", "post"].map((t) => path.join(PRACTICE, "linked_id_prepost", `${t}.csv`));
const truth = (d: string) => JSON.parse(readFileSync(path.join(PRACTICE, d, "ground_truth.json"), "utf8"));
const GT = truth("messy_qualtrics");

let engine: StdioTransport;
let tmp: string;

beforeAll(async () => {
  const cmd = resolveEngineCommand(REPO);
  engine = StdioTransport.start(cmd, { timeoutMs: 120_000 });
  setTransport(engine);
  const pong = await rpc.ping();
  expect(pong.pong).toBe(true);
  console.log(`[engine-suite] ${cmd.source}: ${cmd.command} (engine ${pong.engine_version}, py ${pong.python_version})`);
  tmp = mkdtempSync(path.join(os.tmpdir(), "statly-engine-suite-"));
}, 120_000);

afterAll(async () => {
  const code = await engine?.close();
  const calls = engine?.stderr.filter((l) => /^\[engine\] /.test(l)) ?? [];
  const failed = calls.filter((l) => !/ ok\b/.test(l));
  console.log(`[engine-suite] engine exit=${code}; ${calls.length} logged calls, ${failed.length} non-ok`);
  for (const l of failed) console.log(`  ${l}`);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  useImportFlow.getState().reset();
  useDatasetStore.getState().clear();
  useProjectStore.setState({ project: null, path: null, dirty: false, recovered: false, recoverable: [], guard: null });
});

async function previewFiles(paths: string[]) {
  const s = useImportFlow.getState();
  s.addFiles(paths);
  const ok = await s.runPreview();
  expect(useImportFlow.getState().error).toBeNull();
  expect(ok).toBe(true);
  return useImportFlow.getState();
}

/** Tick every confirmation the clean-up step asks for, as a user accepting defaults would. */
function confirmCleanup() {
  const { preview, decisions, update } = useImportFlow.getState();
  const sets = findResponseSets(preview!.files);
  const nc = findNoncontiguous(preview!.files);
  update({
    responseConfirmed: Object.fromEntries(sets.map((x) => [x.key, true])),
    noncontiguousAck: Object.fromEntries(nc.map((v) => [v.variable, true])),
  });
  expect(blockingReason("cleanup", preview, useImportFlow.getState().decisions, preview!.files.length)).toBeNull();
  return { sets, nc, decisions };
}

async function commit(): Promise<DatasetMeta> {
  const ok = await useImportFlow.getState().commit();
  expect(useImportFlow.getState().error).toBeNull();
  expect(ok).toBe(true);
  return useDatasetStore.getState().meta!;
}

async function allRows(meta: DatasetMeta, columns: string[] | null = null): Promise<{ ids: number[]; rows: CellValue[][]; cols: string[] }> {
  const ids: number[] = [];
  const rows: CellValue[][] = [];
  let cols: string[] = [];
  for (let off = 0; off < meta.n_rows; off += 2000) {
    const page = await rpc.rows({ dataset_id: meta.dataset_id, snapshot_id: meta.snapshot_id, offset: off, limit: 2000, columns, sort: null });
    expect(page.total_rows).toBe(meta.n_rows);
    ids.push(...page.row_ids);
    rows.push(...page.rows);
    cols = page.columns;
  }
  return { ids, rows, cols };
}

const column = async (meta: DatasetMeta, name: string) => (await allRows(meta, [name])).rows.map((r) => r[0]);
const varOf = (meta: DatasetMeta, name: string) => meta.variables.find((v) => v.name === name);

describe("messy Qualtrics export (3-row header, numeric codes)", () => {
  let meta: DatasetMeta;

  it("previews with Qualtrics detected, PII proposed for removal, Q6 codes flagged", async () => {
    const s = await previewFiles([MESSY]);
    const f: FilePreview = s.preview!.files[0];
    expect(f.qualtrics.detected).toBe(true);
    expect(f.qualtrics.header_rows).toBe(3);
    expect(f.n_rows).toBe(GT.n_rows_total);
    expect([...s.decisions!.dropColumns].sort()).toEqual([...GT.pii_columns].sort());
    expect(f.multiselect_candidates).toEqual([GT.multiselect_column]);
    expect(findNoncontiguous(s.preview!.files)).toEqual([{ variable: "Q6", codes: GT.q6_recode_values }]);
    expect(blockingReason("cleanup", s.preview, s.decisions, 1)).toMatch(/codes/);
  });

  it("imports through the wizard's request: 108 rows, PII gone, Q7 split into indicators", async () => {
    await previewFiles([MESSY]);
    confirmCleanup();
    meta = await commit();
    expect(meta.n_rows).toBe(GT.n_valid_after_status_filter);
    for (const c of GT.pii_columns) expect(varOf(meta, c)).toBeUndefined();
    const status = await column(meta, "Status");
    expect(status.filter((v) => v === "Survey Preview" || v === "Spam")).toHaveLength(0);
    // Q6 keeps its Qualtrics recode values.
    const q6 = new Set((await column(meta, "Q6")).filter((v) => v !== null && v !== GT.missing_code));
    expect([...q6].sort()).toEqual(GT.q6_recode_values);
    // Multi-select split: one 0/1 indicator per option, blank question -> null.
    const ind = meta.variables.filter((v) => v.sources[0]?.original_column_name === "Q7" && v.name !== "Q7");
    expect(ind.map((v) => v.label).sort()).toEqual([...GT.multiselect_options].sort());
    const q7 = await column(meta, "Q7");
    for (const v of ind) {
      const vals = await column(meta, v.name);
      vals.forEach((x, i) => {
        if (q7[i] === null) expect(x).toBeNull();
        else expect(x).toBe(String(q7[i]).split(",").map((t) => t.trim()).includes(v.label!) ? 1 : 0);
      });
    }
    expect(meta.scales.map((sc) => sc.id)).toContain("scale_Q5");
    expect(useDatasetStore.getState().showMetadata).toBe(false);
  });

  it("saves, closes and reopens the .statly project with identical meta and rows", async () => {
    expect(meta).toBeDefined();
    // Re-establish the state the import left (beforeEach cleared the stores).
    useProjectStore.getState().newProject("Messy");
    useDatasetStore.getState().setMeta(meta);
    const before = await allRows(meta);
    const file = path.join(tmp, "Messy survey.statly");
    await useProjectStore.getState().saveTo(file);
    const savedMeta = useDatasetStore.getState().meta!;
    expect(savedMeta).toEqual(meta);
    expect(useProjectStore.getState().dirty).toBe(false);

    useProjectStore.getState().close();
    expect(useDatasetStore.getState().meta).toBeNull();

    const project = await useProjectStore.getState().open(file);
    const reopened = useDatasetStore.getState().meta!;
    expect(project.name).toBe("Messy survey");
    expect(reopened).toEqual(meta);
    expect(reopened.n_rows).toBe(GT.n_valid_after_status_filter);
    const after = await allRows(reopened);
    expect(after.cols).toEqual(before.cols);
    expect(after.ids).toEqual(before.ids);
    expect(after.rows).toEqual(before.rows);
  });
});

describe("messy Qualtrics export with text answer choices", () => {
  it("defaults: answer text is coded 1-5", async () => {
    const s = await previewFiles([MESSY_TEXT]);
    const sets = findResponseSets(s.preview!.files);
    expect(sets.map((x) => x.variables)).toEqual([["Q5_1", "Q5_2", "Q5_3", "Q5_4", "Q5_5", "Q5_6"], ["Q6"]]);
    expect(blockingReason("cleanup", s.preview, s.decisions, 1)).toMatch(/order/);
    confirmCleanup();
    const meta = await commit();
    expect(meta.n_rows).toBe(GT.n_valid_after_status_filter);
    expect(varOf(meta, "Q6")!.dtype).toBe("integer");
    const q6 = new Set((await column(meta, "Q6")).filter((v) => v !== null && v !== GT.missing_code));
    expect([...q6].sort()).toEqual([1, 2, 3, 4, 5]);
    const q51 = new Set((await column(meta, "Q5_1")).filter((v) => v !== null && v !== GT.missing_code));
    expect([...q51].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("user-confirmed codes 1,2,4,5,7 reproduce the numeric export's Q6 exactly", async () => {
    // Reference: the numeric export.
    await previewFiles([MESSY]);
    confirmCleanup();
    const numeric = await column(await commit(), "Q6");
    useImportFlow.getState().reset();

    const s = await previewFiles([MESSY_TEXT]);
    const q6set = findResponseSets(s.preview!.files).find((x) => x.variables.includes("Q6"))!;
    s.update({ responseCodes: { [q6set.key]: GT.q6_recode_values } });
    confirmCleanup();
    const q6param = buildImportParams(useImportFlow.getState().preview!, useImportFlow.getState().decisions!).variables.find((v) => v.name === "Q6")!;
    expect(q6param.value_labels.map((l) => l.value)).toEqual(GT.q6_recode_values);
    const meta = await commit();
    const q6 = await column(meta, "Q6");
    expect([...new Set(q6.filter((v) => v !== null && v !== GT.missing_code))].sort()).toEqual(GT.q6_recode_values);
    expect(q6).toEqual(numeric);
    expect(varOf(meta, "Q6")!.value_labels.map((l) => l.value)).toEqual(GT.q6_recode_values);
  });
});

describe("xlsx sheet choice", () => {
  it("keeps file_id across a sheet change and imports the Data sheet", async () => {
    const s = await previewFiles([MESSY_XLSX]);
    const id = s.preview!.files[0].file_id;
    expect(s.preview!.files[0].sheets).toEqual(GT.files["messy.xlsx"].sheets);
    await useImportFlow.getState().changeSheet(id, "Data");
    const after = useImportFlow.getState();
    expect(after.error).toBeNull();
    expect(after.preview!.files[0].file_id).toBe(id);
    expect(after.preview!.files[0].sheet_name).toBe("Data");
    expect(after.preview!.files[0].qualtrics.header_rows).toBe(3);
    confirmCleanup();
    const meta = await commit();
    expect(meta.n_rows).toBe(GT.n_valid_after_status_filter);
    expect(meta.import_log.files[0].file_id).toBe(id);
  });
});

describe("three files stacked (linking off)", () => {
  it("stacks pre/post/follow-up with the time variable and per-time counts", async () => {
    const g = truth("three_groups_prepost_followup");
    const s = await previewFiles(THREE);
    expect(s.preview!.files.map((f) => s.decisions!.timeLabels[f.file_id])).toEqual(["Pre", "Post", "Follow-up"]);
    confirmCleanup();
    const pending = (s.preview!.stack_proposal ?? []).filter((m) => m.status === "possibly_renamed");
    useImportFlow.getState().update({ matchDecisions: Object.fromEntries(pending.map((m) => [m.variable, "accept" as const])) });
    expect(blockingReason("stack", s.preview, useImportFlow.getState().decisions, 3)).toBeNull();
    expect(useImportFlow.getState().decisions!.linkMode).toBe("aggregate");
    const meta = await commit();
    expect(meta.stacking?.time_variable).toBe("Time");
    expect(meta.stacking?.levels.map((l) => l.label)).toEqual(["Pre", "Post", "Follow-up"]);
    expect(meta.link.mode).toBe("aggregate");
    const time = await column(meta, "Time");
    const perTime = { Pre: 0, Post: 0, "Follow-up": 0 } as Record<string, number>;
    for (const t of time) perTime[String(t)]++;
    expect(perTime).toEqual({ Pre: g.n_total_per_time.pre, Post: g.n_total_per_time.post, "Follow-up": g.n_total_per_time.followup });
    expect(meta.n_rows).toBe(g.n_total_per_time.pre + g.n_total_per_time.post + g.n_total_per_time.followup);
    const groups = new Set(await column(meta, g.group_variable));
    expect([...groups].sort()).toEqual(g.groups);
  });
});

describe("two files linked by ID", () => {
  it("links pre/post on Q1 with trimming + case folding", async () => {
    const g = truth("linked_id_prepost");
    await previewFiles(LINKED);
    confirmCleanup();
    useImportFlow.getState().update({ linkMode: "linked", idVariable: g.id_column });
    const { preview, decisions } = useImportFlow.getState();
    expect(blockingReason("link", preview, decisions, 2)).toBeNull();
    const meta = await commit();
    const report = useImportFlow.getState().result!.linkReport!;
    expect(meta.link.mode).toBe("linked");
    expect(meta.link.id_variable).toBe(g.id_column);
    expect(meta.n_rows).toBe(g.n_pre_rows + g.n_post_rows);
    expect(meta.link.counts).toMatchObject({
      matched: g.n_matched_after_normalization,
      unmatched: g.n_pre_only + g.n_post_only,
      duplicate: g.n_duplicated_ids_in_post,
    });
    expect(report.counts).toEqual(meta.link.counts);
    expect([...report.duplicate_ids].sort()).toEqual(g.duplicated_ids);
  });
});
