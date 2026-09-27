import { beforeEach, describe, expect, it } from "vitest";
import type { DatasetMeta, SurveySuggestResult } from "@/contracts";
import { findNoncontiguous, findResponseSets, surveyPatches } from "@/lib/importLogic";
import { buildUnits, initialDraft } from "@/lib/interviewLogic";
import { MOCK_SURVEY_PATH, Q5_STATEMENTS } from "@/mocks/shapes";
import { useDatasetStore } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";
import { applySurveySeed, useInterview } from "@/stores/interview";
import { MESSY, useFreshMock } from "@/test/mockTransport";

const AGREE = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];

beforeEach(() => {
  useFreshMock();
  useInterview.setState({ surveySeed: null });
  useInterview.getState().reset();
});

async function importWithSurvey(): Promise<DatasetMeta> {
  const s = useImportFlow.getState();
  expect(await s.addSurvey(MOCK_SURVEY_PATH)).toBe(true);
  s.addFiles([MESSY]);
  expect(await useImportFlow.getState().runPreview()).toBe(true);
  const { preview, update } = useImportFlow.getState();
  update({
    responseConfirmed: Object.fromEntries(findResponseSets(preview!.files).map((x) => [x.key, true])),
    noncontiguousAck: Object.fromEntries(findNoncontiguous(preview!.files).map((v) => [v.variable, true])),
  });
  await useImportFlow.getState().checkSurvey();
  expect(await useImportFlow.getState().commit()).toBe(true);
  return useDatasetStore.getState().meta!;
}

describe("survey file (.qsf) in the import wizard", () => {
  it("rejects a file that isn't a .qsf and keeps the wizard usable", async () => {
    expect(await useImportFlow.getState().addSurvey(MESSY)).toBe(false);
    const s = useImportFlow.getState();
    expect(s.survey).toBeNull();
    expect(s.surveyError).toMatch(/Qualtrics survey/);
    expect(s.busy).toBe(false);
  });

  it("shows the survey, matches it, stores it, fills in metadata and seeds the interview", async () => {
    const meta = await importWithSurvey();
    const s = useImportFlow.getState();
    expect(s.survey!.survey.name).toBe("Course Experience Survey – Fall");
    expect(s.survey!.nQuestions).toBe(7);
    expect(s.surveyMatch!.questions).toBeGreaterThanOrEqual(6);

    expect(meta.import_log.files.map((f) => f.role ?? "data")).toEqual(["data", "survey"]);
    const q51 = meta.variables.find((v) => v.name === "Q5_1")!;
    expect(q51.label).toBe(Q5_STATEMENTS[0]);
    expect(q51.value_labels.map((l) => l.label)).toEqual(AGREE);
    expect(s.result!.survey!.columns.length).toBeGreaterThan(0);

    const seed = useInterview.getState().surveySeed!;
    expect(seed).toMatchObject({ datasetId: meta.dataset_id, mode: "full" });

    useInterview.getState().reset(); // the wizard does this before opening the interview
    await useInterview.getState().start();
    const iv = useInterview.getState();
    const q5 = iv.units.find((u) => u.names.includes("Q5_1"))!;
    expect(iv.filledFrom.units[q5.id]).toBe("survey");
    const scale = iv.draft!.scales.find((x) => x.items.includes("Q5_1"))!;
    expect(iv.filledFrom.scales[scale.key]).toBe("survey");

    // Changing a pre-filled answer drops its marker; leaving it alone keeps it.
    iv.setAnswer(q5.id, { role: "likert_item" });
    expect(useInterview.getState().filledFrom.units[q5.id]).toBe("survey");
    iv.setAnswer(q5.id, { role: "demographic" });
    expect(useInterview.getState().filledFrom.units[q5.id]).toBeUndefined();
  });
});

describe("applySurveySeed", () => {
  async function setup() {
    const meta = await importWithSurvey();
    const seed = useInterview.getState().surveySeed!.suggestions;
    const units = buildUnits(meta);
    const draft = initialDraft(meta, units, {});
    return { meta, seed, units, draft };
  }
  const withReverse = (s: SurveySuggestResult): SurveySuggestResult => ({
    ...s,
    columns: s.columns.map((c) => (c.name === "Q5_4" ? { ...c, reverse_hint: true } : c)),
  });

  it("pre-ticks reverse hints and adds a suggested scale when none covers the items", async () => {
    const { meta, seed, units, draft } = await setup();
    const noScales = { ...draft, scales: [] };
    const out = applySurveySeed(meta, units, noScales, withReverse(seed), "full");
    expect(out.draft.reverse.Q5_4).toBe(true);
    expect(out.filledFrom.reverse.Q5_4).toBe("survey");
    const added = out.draft.scales.find((x) => x.key === "survey:Q5")!;
    expect(added).toMatchObject({ id: null, placeholderName: "Q5", method: "mean" });
    expect(added.name.length).toBeGreaterThan(0);
    expect(out.filledFrom.scales["survey:Q5"]).toBe("survey");
  });

  it("only marks, never changes, in annotate mode or where the user set another role", async () => {
    const { meta, seed, units, draft } = await setup();
    const out = applySurveySeed(meta, units, { ...draft, scales: [] }, withReverse(seed), "annotate");
    expect(out.draft.reverse.Q5_4 ?? false).toBe(false);
    expect(out.draft.scales).toEqual([]);
    expect(out.filledFrom.reverse.Q5_4).toBeUndefined();

    const q9 = units.find((u) => u.names.includes("Q9"))!;
    const userMeta: DatasetMeta = {
      ...meta,
      variables: meta.variables.map((v) => (v.name === "Q9" ? { ...v, role: "group" } : v)),
    };
    const d2 = { ...draft, answers: { ...draft.answers, [q9.id]: { ...draft.answers[q9.id], role: "group" as const } } };
    const kept = applySurveySeed(userMeta, units, d2, seed, "full");
    expect(kept.draft.answers[q9.id].role).toBe("group");
    expect(kept.filledFrom.units[q9.id]).toBeUndefined();
  });
});

describe("surveyPatches", () => {
  it("fills only empty fields and never puts numeric codes on a text column", async () => {
    const meta = await importWithSurvey();
    const seed = useInterview.getState().surveySeed!.suggestions;
    const q1 = seed.columns.find((c) => c.name === "Q1")!;
    const custom: DatasetMeta = {
      ...meta,
      variables: meta.variables.map((v) =>
        v.name === "Q5_2" ? { ...v, label: "My own label", value_labels: [] } : v.name === "Q1" ? { ...v, dtype: "string", value_labels: [] } : v,
      ),
    };
    const s2: SurveySuggestResult = {
      ...seed,
      columns: seed.columns.map((c) => (c.name === "Q5_2" ? { ...c, differs_from_current: ["label"] } : c)),
    };
    const patches = surveyPatches(custom, s2);
    const p52 = patches.find((p) => p.name === "Q5_2")!;
    expect(p52.label).toBeUndefined();
    expect(p52.value_labels?.map((l) => l.label)).toEqual(AGREE);
    expect(q1.value_labels.every((l) => typeof l.value === "number")).toBe(true);
    expect(patches.find((p) => p.name === "Q1")?.value_labels).toBeUndefined();
  });
});
