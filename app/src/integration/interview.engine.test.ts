// @vitest-environment node
/**
 * Real-engine integration tests for the Variable Interview (SPEC §6, Phase 2): the same stores
 * the screens use (importFlow -> interview -> variableEdits -> history) drive a real engine
 * process, and each of the four practice datasets is taken through the interview to a scored,
 * scaled dataset whose numbers are checked against the fixtures' ground truth.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CellValue, DatasetMeta } from "@/contracts";
import { blockingReason, findNoncontiguous, findResponseSets } from "@/lib/importLogic";
import { rpc, setTransport } from "@/lib/rpc";
import { resolveEngineCommand, StdioTransport } from "@/lib/transports/stdio";
import { EditError, edits } from "@/lib/variableEdits";
import { useDatasetStore } from "@/stores/dataset";
import { useHistory } from "@/stores/history";
import { useImportFlow } from "@/stores/importFlow";
import { useInterview } from "@/stores/interview";
import { useProjectStore } from "@/stores/project";

const REPO = path.resolve(import.meta.dirname, "../../..");
const PRACTICE = path.join(REPO, "fixtures", "practice");
const MESSY = path.join(PRACTICE, "messy_qualtrics", "messy_3header.csv");
const THREE_DIR = path.join(PRACTICE, "three_groups_prepost_followup");
const THREE = ["pre", "post", "followup"].map((t) => path.join(THREE_DIR, `${t}.csv`));
const ONE = ["pre", "post"].map((t) => path.join(PRACTICE, "one_group_prepost_likert", `${t}.csv`));
const LINKED = ["pre", "post"].map((t) => path.join(PRACTICE, "linked_id_prepost", `${t}.csv`));
const truth = (d: string) => JSON.parse(readFileSync(path.join(PRACTICE, d, "ground_truth.json"), "utf8"));
const Q5 = ["Q5_1", "Q5_2", "Q5_3", "Q5_4", "Q5_5", "Q5_6"];

let engine: StdioTransport;
let tmp: string;

beforeAll(async () => {
  engine = StdioTransport.start(resolveEngineCommand(REPO), { timeoutMs: 120_000 });
  setTransport(engine);
  expect((await rpc.ping()).pong).toBe(true);
  tmp = mkdtempSync(path.join(os.tmpdir(), "statly-interview-suite-"));
}, 120_000);

afterAll(async () => {
  await engine?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  useImportFlow.getState().reset();
  useInterview.getState().reset();
  useDatasetStore.getState().clear();
  useProjectStore.getState().newProject("Interview test");
});

// --- helpers -------------------------------------------------------------------------------

async function importFiles(paths: string[], opts: { linkBy?: string } = {}): Promise<DatasetMeta> {
  const s = useImportFlow.getState();
  s.addFiles(paths);
  expect(await s.runPreview()).toBe(true);
  const { preview } = useImportFlow.getState();
  const update = useImportFlow.getState().update;
  update({
    responseConfirmed: Object.fromEntries(findResponseSets(preview!.files).map((x) => [x.key, true])),
    noncontiguousAck: Object.fromEntries(findNoncontiguous(preview!.files).map((v) => [v.variable, true])),
  });
  const pending = (preview!.stack_proposal ?? []).filter((m) => m.status === "possibly_renamed");
  if (pending.length) update({ matchDecisions: Object.fromEntries(pending.map((m) => [m.variable, "accept" as const])) });
  if (opts.linkBy) update({ linkMode: "linked", idVariable: opts.linkBy });
  expect(blockingReason("cleanup", preview, useImportFlow.getState().decisions, paths.length)).toBeNull();
  expect(await useImportFlow.getState().commit()).toBe(true);
  return useDatasetStore.getState().meta!;
}

async function table(meta: DatasetMeta, columns: string[]): Promise<Record<string, CellValue[]>> {
  const out: Record<string, CellValue[]> = Object.fromEntries(columns.map((c) => [c, []]));
  for (let off = 0; off < meta.n_rows; off += 2000) {
    const page = await rpc.rows({ dataset_id: meta.dataset_id, snapshot_id: meta.snapshot_id, offset: off, limit: 2000, columns, sort: null });
    for (const r of page.rows) columns.forEach((c, j) => out[c].push(r[j]));
  }
  return out;
}

/** Walk the interview with the pre-filled answers (plus `tweak` on the draft), then Finish. */
async function runInterview(tweak: (i: ReturnType<typeof useInterview.getState>) => void = () => {}): Promise<DatasetMeta> {
  await useInterview.getState().start();
  const i = useInterview.getState();
  expect(i.status).toBe("ready");
  tweak(useInterview.getState());
  let guard = 0;
  while (useInterview.getState().step !== "summary") {
    expect(useInterview.getState().problem()).toBeNull();
    useInterview.getState().next();
    expect(guard++).toBeLessThan(200);
  }
  const ok = await useInterview.getState().finish();
  expect(useInterview.getState().error).toBeNull();
  expect(ok).toBe(true);
  return useDatasetStore.getState().meta!;
}

const varOf = (meta: DatasetMeta, name: string) => meta.variables.find((v) => v.name === name)!;
const num = (x: CellValue) => (x === null ? null : Number(x));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// --- messy_qualtrics -----------------------------------------------------------------------

describe("messy_qualtrics interview", () => {
  it("scores the Q5 matrix as a scale with Q5_4 reversed and leaves the Q7 indicators untouched", async () => {
    const imported = await importFiles([MESSY]);
    const q7 = imported.variables.filter((v) => v.sources[0]?.original_column_name === "Q7" && v.name !== "Q7").map((v) => v.name);
    expect(q7.length).toBeGreaterThan(0);
    const before = await table(imported, [...Q5, ...q7]);

    const meta = await runInterview((i) => {
      expect(i.units.find((u) => u.id === "scale:scale_Q5")?.names).toEqual(Q5);
      expect(i.draft!.answers["scale:scale_Q5"].role).toBe("likert_item");
      expect(i.draft!.answers["var:SC0"].role).toBe("test_total");
      i.setDraft({ reverse: { Q5_4: true } });
    });

    const scale = meta.scales.find((s) => s.id === "scale_Q5")!;
    expect(scale).toMatchObject({ items: Q5, scoring_method: "mean", min_items: 3 });
    const scoreVar = varOf(meta, scale.score_variable!);
    expect(scoreVar.role).toBe("scale_score");
    expect(varOf(meta, "Q5_4").reverse_coded).toBe(true);
    expect(Q5.every((n) => varOf(meta, n).scale_id === "scale_Q5" && varOf(meta, n).role === "likert_item")).toBe(true);

    // Score = mean of answered items (-99 missing, Q5_4 reversed on 1..5), needs >= 3 answered.
    const t = await table(meta, [...Q5, ...q7, scoreVar.name]);
    t[scoreVar.name].forEach((got, r) => {
      const xs = Q5.map((n) => num(t[n][r])).map((x, k) => (x === null || x === -99 ? null : Q5[k] === "Q5_4" ? 6 - x : x)).filter((x): x is number => x !== null);
      if (xs.length >= 3) expect(got).toBeCloseTo(mean(xs), 10);
      else expect(got).toBeNull();
    });
    // Raw items and Q7 indicators are unchanged; indicators stay out of scales.
    for (const n of [...Q5, ...q7]) expect(t[n]).toEqual(before[n]);
    for (const n of q7) expect(varOf(meta, n)).toMatchObject({ scale_id: null, reverse_coded: false });

    // Undo / redo through the project store hooks.
    const labels = useHistory.getState().entries.map((e) => e.label);
    expect(labels.slice(-2)).toEqual(["Variable interview answers", "Scored scale Q5"]);
    expect(useProjectStore.getState().canUndo()).toBe(true);
    expect(await useProjectStore.getState().undo()).toBe(true);
    const undone = useDatasetStore.getState().meta!;
    expect(undone.variables.some((v) => v.name === scoreVar.name)).toBe(false);
    expect(varOf(undone, "Q5_4").reverse_coded).toBe(true);
    expect(await useProjectStore.getState().redo()).toBe(true);
    expect(useDatasetStore.getState().meta!.snapshot_id).toBe(meta.snapshot_id);
    expect(useProjectStore.getState().canRedo()).toBe(false);

    // An edit on the Variables screen, then save/load keeps the history labels.
    await edits.updateVariables([{ name: "Q1", label: "Consent" }]);
    const file = path.join(tmp, "messy.statly");
    await useProjectStore.getState().saveTo(file);
    const savedLabels = useHistory.getState().entries.map((e) => e.label);
    useProjectStore.getState().close();
    await useProjectStore.getState().open(file);
    await useHistory.getState().refresh();
    const h = useHistory.getState();
    expect(h.entries.map((e) => e.label)).toEqual(savedLabels);
    expect(h.entries.at(-1)!.restorable).toBe(true);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
});

// --- three_groups_prepost_followup ---------------------------------------------------------

describe("three_groups_prepost_followup interview", () => {
  it("scores the knowledge test with the answer key file, then adds a gain check", async () => {
    const g = truth("three_groups_prepost_followup");
    const imported = await importFiles(THREE);
    const key = await rpc.parseAnswerKey({ path: path.join(THREE_DIR, "answer_key.csv") });
    expect(key.entries).toHaveLength(g.n_items);

    const meta = await runInterview((i) => {
      expect(i.draft!.answers["group:Q4"].role).toBe("test_item");
      expect(i.draft!.answers["var:Q2"].role).toBe("group");
      i.setDraft({ key: Object.fromEntries(key.entries.map((e) => [e.item, e.correct!.map(String)])) });
    });
    expect(imported.variables.length).toBeLessThan(meta.variables.length);
    const total = varOf(meta, "Q4_total");
    expect(total).toMatchObject({ role: "test_total", level: "continuous" });
    expect(varOf(meta, "Q2").value_labels.map((l) => l.value)).toEqual(g.groups);
    expect(varOf(meta, "Q4_1_correct").role).toBe("test_item");

    const t = await table(meta, ["Q2", "Time", "Q4_total", "SC0"]);
    t.Q4_total.forEach((x, r) => expect(x).toBe(num(t.SC0[r])));
    const timeKey: Record<string, string> = { Pre: "pre", Post: "post", "Follow-up": "fu" };
    for (const group of g.groups as string[]) {
      for (const [label, k] of Object.entries(timeKey)) {
        const xs = t.Q4_total.filter((_, r) => t.Q2[r] === group && t.Time[r] === label).map(Number);
        expect(xs.length).toBe(g.achieved[group][k].n);
        expect(mean(xs) / g.n_items).toBeCloseTo(g.achieved[group][k].mean_proportion_correct, 4);
      }
    }

    // Row-level gain-style difference (Statly total - Qualtrics SC0) is 0 everywhere.
    const def = { op: "difference" as const, minuend: { variable: "Q4_total", time_level: null }, subtrahend: { variable: "SC0", time_level: null } };
    const preview = await rpc.previewComputed({ dataset_id: meta.dataset_id, definition: def });
    expect(preview.values).toEqual(Array(10).fill(0));
    await edits.addComputed({ name: "total_check", definition: def });
    const check = await table(useDatasetStore.getState().meta!, ["total_check"]);
    expect(new Set(check.total_check)).toEqual(new Set([0]));

    // A post - pre gain needs linked people; these exports have no shared ID.
    await expect(
      edits.addComputed({ name: "gain", definition: { op: "difference", minuend: { variable: "Q4_total", time_level: "Post" }, subtrahend: { variable: "Q4_total", time_level: "Pre" } } }),
    ).rejects.toThrow(EditError);
    await expect(
      edits.addComputed({ name: "gain", definition: { op: "difference", minuend: { variable: "Q4_total", time_level: "Post" }, subtrahend: { variable: "Q4_total", time_level: "Pre" } } }),
    ).rejects.toThrow(/link people/i);
  });
});

// --- one_group_prepost_likert --------------------------------------------------------------

describe("one_group_prepost_likert interview", () => {
  it("reverse-scores Q3_3 and Q3_8 and reproduces the planted scale means", async () => {
    const g = truth("one_group_prepost_likert");
    await importFiles(ONE);
    const meta = await runInterview((i) => {
      i.setDraft({ reverse: Object.fromEntries(g.reverse_worded_items.map((n: string) => [n, true])) });
    });
    const scale = meta.scales[0];
    expect(scale.items).toEqual(g.matrix_items);
    const t = await table(meta, ["Time", scale.score_variable!]);
    const byTime = (label: string) => mean(t[scale.score_variable!].filter((_, r) => t.Time[r] === label).map(Number));
    expect(byTime("Pre")).toBeCloseTo(g.achieved.pre_scale_mean, 4);
    expect(byTime("Post")).toBeCloseTo(g.achieved.post_scale_mean, 4);
  });
});

// --- linked_id_prepost ---------------------------------------------------------------------

describe("linked_id_prepost interview", () => {
  it("sets up roles and adds a participant-level gain score", async () => {
    const g = truth("linked_id_prepost");
    await importFiles(LINKED, { linkBy: g.id_column });
    const meta = await runInterview((i) => {
      expect(i.draft!.answers["var:Q1"].role).toBe("identifier");
      expect(i.draft!.answers["var:Q4"].role).toBe("test_total");
    });
    expect(varOf(meta, "Q1").role).toBe("identifier");
    const def = {
      op: "difference" as const,
      minuend: { variable: "Q4", time_level: "Post" },
      subtrahend: { variable: "Q4", time_level: "Pre" },
    };
    const preview = await rpc.previewComputed({ dataset_id: meta.dataset_id, definition: def });
    expect(preview.values).toHaveLength(10);
    expect(preview.warnings.map((w) => w.code)).toContain("duplicate_ids_at_level");
    await edits.addComputed({ name: "Q4_gain", label: "Gain (post - pre)", definition: def });
    const after = useDatasetStore.getState().meta!;
    expect(varOf(after, "Q4_gain")).toMatchObject({ role: "test_total", dtype: "float" });
    const t = await table(after, ["Q1", "Q4_gain"]);
    const perId = new Map<string, Set<CellValue>>();
    t.Q1.forEach((id, r) => {
      const k = String(id).trim().toUpperCase();
      perId.set(k, (perId.get(k) ?? new Set()).add(t.Q4_gain[r]));
    });
    for (const vals of perId.values()) expect(vals.size).toBe(1);
    const gains = [...perId.values()].map((s) => [...s][0]).filter((x): x is number => x !== null);
    expect(gains.length).toBe(g.n_matched_after_normalization - g.duplicated_ids.length);
    expect(mean(gains)).toBeGreaterThan(0);
  });
});
