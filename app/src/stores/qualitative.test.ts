import { beforeEach, describe, expect, it } from "vitest";
import type { DatasetMeta } from "@/contracts";
import type { MockEngine } from "@/mocks/engine";
import { MESSY, useFreshMock } from "@/test/mockTransport";
import { findNoncontiguous, findResponseSets } from "@/lib/importLogic";
import { useDatasetStore } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";
import { useProjectStore } from "@/stores/project";
import { groupingVariables, textVariables, useQualitative, withApplication } from "@/stores/qualitative";

let engine: MockEngine;
const q = () => useQualitative.getState();

async function importMessy(): Promise<DatasetMeta> {
  useProjectStore.getState().newProject("Coding");
  const s = useImportFlow.getState();
  s.addFiles([MESSY]);
  if (!(await s.runPreview())) throw new Error("preview failed");
  const { preview, update } = useImportFlow.getState();
  update({
    responseConfirmed: Object.fromEntries(findResponseSets(preview!.files).map((x) => [x.key, true])),
    noncontiguousAck: Object.fromEntries(findNoncontiguous(preview!.files).map((v) => [v.variable, true])),
  });
  if (!(await useImportFlow.getState().commit())) throw new Error(useImportFlow.getState().error ?? "import failed");
  return useDatasetStore.getState().meta!;
}

beforeEach(async () => {
  engine = useFreshMock();
  q().reset();
  await q().init(await importMessy());
});

describe("qualitative store", () => {
  it("picks the open-ended question and loads the first page", () => {
    const meta = useDatasetStore.getState().meta!;
    expect(textVariables(meta)[0].role).toBe("open_text");
    expect(groupingVariables(meta).map((v) => v.name)).toContain("Q6");
    expect(q().variable).toBe(textVariables(meta)[0].name);
    expect(q().total).toBeGreaterThan(0);
    expect(Object.keys(q().items).length).toBe(Math.min(q().total, 100));
  });

  it("creates tags, toggles them on a response (optimistic + engine), and marks the project dirty", async () => {
    await q().setVariable("Q10");
    useProjectStore.setState({ dirty: false });
    expect(await q().saveTag({ name: "Pacing", definition: "Talks about speed" })).toBe(true);
    expect(await q().saveTag({ name: "pacing" })).toBe(false); // duplicate names are refused
    expect(q().error).toMatch(/already a tag/);
    await q().saveTag({ name: "Fairness" });
    const [pacing, fair] = q().codebook.tags;
    expect(pacing.color).toBe("#0072B2");
    await q().toggleTag(0, fair.id);
    await q().toggleTag(0, pacing.id);
    expect(q().items[0].tag_ids).toEqual([pacing.id, fair.id]); // codebook order
    await q().toggleTag(0, fair.id);
    expect(q().items[0].tag_ids).toEqual([pacing.id]);
    expect(useProjectStore.getState().dirty).toBe(true);
    const applied = engine.calls.filter((c) => c.method === "tags.apply").map((c) => (c.params as { tag_ids: string[] }).tag_ids);
    expect(applied).toEqual([[fair.id], [pacing.id, fair.id], [pacing.id]]);
    expect(q().codebook.applications).toEqual([{ row_id: q().items[0].row_id, variable: "Q10", tag_ids: [pacing.id] }]);
  });

  it("searches with match spans and filters by tag and group", async () => {
    await q().setVariable("Q10");
    await q().setSearch('pace "fine"');
    const first = q().items[0];
    expect(first.matches.map(([s, e]) => first.text.slice(s, e).toLowerCase())).toEqual(["fine", "pace"]);
    await q().setSearch("zebra");
    expect(q().total).toBe(0);
    await q().setSearch("");
    await q().saveTag({ name: "A" });
    const a = q().codebook.tags[0];
    await q().toggleTag(2, a.id);
    await q().setTagFilter(a.id);
    expect(q().total).toBe(1);
    await q().setTagFilter("untagged");
    const all = q().totalResponses;
    expect(q().total).toBe(all - 1);
    await q().setTagFilter(null);
    await q().setFilter("Q6", [1]);
    expect(Object.values(q().items).every((it) => it.context !== undefined)).toBe(true);
    const onlyQ6 = q().total;
    expect(onlyQ6).toBeGreaterThan(0);
    expect(onlyQ6).toBeLessThan(all);
    expect(engine.calls[engine.calls.length - 1].params).toMatchObject({ filters: [{ variable: "Q6", values: [1] }] });
  });

  it("summarizes by group and turns tags into yes/no variables", async () => {
    await q().setVariable("Q10");
    await q().saveTag({ name: "Pacing" });
    const t = q().codebook.tags[0];
    for (const i of [0, 1, 2]) await q().toggleTag(i, t.id);
    await q().loadSummary("Q6");
    const s = q().summary!;
    expect(s.overall[0].count).toBe(3);
    expect(s.groups.reduce((n, g) => n + g.counts[0].count, 0) + 0).toBeLessThanOrEqual(3);
    expect(s.groups.reduce((n, g) => n + g.n_responses, 0) + s.n_missing_group).toBe(s.n_responses);
    const before = useDatasetStore.getState().meta!.snapshot_id;
    const created = await q().makeVariables();
    expect(created).toEqual([{ tag_id: t.id, variable: "Q10_pacing", n_yes: 3, n_no: s.n_responses - 3, n_missing: expect.any(Number), updated: false }]);
    const meta = useDatasetStore.getState().meta!;
    expect(meta.snapshot_id).not.toBe(before);
    expect(meta.variables.find((v) => v.name === "Q10_pacing")).toMatchObject({ dtype: "integer", level: "nominal" });
  });

  it("persists the codebook with the project (save -> reopen)", async () => {
    await q().setVariable("Q10");
    await q().saveTag({ name: "Pacing" });
    await q().toggleTag(1, q().codebook.tags[0].id);
    await useProjectStore.getState().saveTo("/mock/coded.statly");
    expect(useProjectStore.getState().project!.tag_codebook!.applications).toHaveLength(1);
    q().reset();
    await useProjectStore.getState().open("/mock/coded.statly");
    await q().init(useDatasetStore.getState().meta!);
    expect(q().codebook.tags.map((t) => t.name)).toEqual(["Pacing"]);
  });

  it("withApplication replaces one response's tags", () => {
    const book = { schema_version: 1 as const, tags: [], applications: [{ row_id: 1, variable: "Q", tag_ids: ["a"] }] };
    expect(withApplication(book, "Q", 1, []).applications).toEqual([]);
    expect(withApplication(book, "Q", 2, ["b"]).applications).toHaveLength(2);
  });
});
