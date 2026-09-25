import { describe, expect, it } from "vitest";
import type { DatasetMeta, VariableSchema } from "@/contracts";
import {
  activeScales,
  buildPlan,
  buildUnits,
  columnStats,
  defaultMinItems,
  guessLevel,
  guessRole,
  initialDraft,
  initialLabels,
  interviewSteps,
  moveItem,
  reorder,
  stepProblem,
  type Draft,
  type Unit,
} from "@/lib/interviewLogic";

function v(name: string, o: Partial<VariableSchema> = {}): VariableSchema {
  return {
    schema_version: 1,
    name,
    label: null,
    question_text: null,
    role: "unassigned",
    level: "nominal",
    dtype: "string",
    value_labels: [],
    reverse_coded: false,
    response_range: null,
    scale_id: null,
    missing_codes: [],
    sources: [{ file_id: "f1", original_column_name: name, qualtrics_import_id: null, header_texts: [name] }],
    is_metadata: false,
    is_pii: false,
    pii_reason: null,
    computed: null,
    display_order: 0,
    ...o,
  };
}

const likert = (name: string) =>
  v(name, { dtype: "integer", level: "ordinal", role: "likert_item", scale_id: "scale_Q5", response_range: { min: 1, max: 5 }, question_text: `Matrix - ${name}` });
const ind = (opt: string) =>
  v(`Q7_${opt}`, {
    dtype: "integer",
    label: opt,
    value_labels: [{ value: 0, label: "Not selected" }, { value: 1, label: "Selected" }],
    sources: [{ file_id: "f1", original_column_name: "Q7", qualtrics_import_id: null, header_texts: [] }],
  });

function meta(vars: VariableSchema[], extra: Partial<DatasetMeta> = {}): DatasetMeta {
  return {
    schema_version: 1,
    dataset_id: "ds",
    snapshot_id: "snap",
    n_rows: 4,
    row_id_column: "_statly_row_id",
    variables: vars.map((x, i) => ({ ...x, display_order: i })),
    scales: [{ id: "scale_Q5", name: "Q5", items: ["Q5_1", "Q5_2", "Q5_3"], scoring_method: "mean", min_items: null, score_variable: null, origin: "matrix_suggestion" }],
    import_log: { files: [], row_filters: [], dropped_columns: [] },
    stacking: null,
    link: { mode: "aggregate", id_variable: null, normalization: null, counts: null },
    missing_summary: [],
    ...extra,
  };
}

const VARS = [
  v("StartDate", { is_metadata: true }),
  v("Q1", { question_text: "Which group are you in?" }),
  likert("Q5_1"),
  likert("Q5_2"),
  likert("Q5_3"),
  v("Q7", { value_labels: [{ value: "Textbook", label: "Textbook" }] }),
  ind("Textbook"),
  ind("Tutor"),
  v("Q7_8_TEXT", { role: "open_text" }),
  v("Q4_1"),
  v("Q4_2"),
  v("SC0", { dtype: "integer", level: "continuous", role: "test_total" }),
  v("Q9_score", { dtype: "float", computed: { op: "scale_mean", items: ["Q5_1", "Q5_2"], min_items: null, scale_id: null } }),
];
const M = meta(VARS);
const COLS = ["Q1", "Q5_1", "Q5_2", "Q5_3", "Q4_1", "Q4_2", "SC0"];
const ROWS = [
  ["Control", 1, 2, 5, "A", "B", 1],
  ["Treatment", 2, 2, 4, "D", "B", 2],
  ["Control", 4, 5, 1, "A", "C", 0],
  ["Treatment", -99, 4, 2, null, "B", 1],
];
const STATS = columnStats(COLS, ROWS, { Q5_1: [-99] });
const byName = new Map(M.variables.map((x) => [x.name, x]));

describe("buildUnits", () => {
  const units = buildUnits(M);
  it("groups matrix scales, multi-select families and Qn_k families; skips metadata and calculated", () => {
    expect(units.map((u) => [u.id, u.names])).toEqual([
      ["var:Q1", ["Q1"]],
      ["scale:scale_Q5", ["Q5_1", "Q5_2", "Q5_3"]],
      ["multi:Q7", ["Q7", "Q7_Textbook", "Q7_Tutor"]],
      ["var:Q7_8_TEXT", ["Q7_8_TEXT"]],
      ["group:Q4", ["Q4_1", "Q4_2"]],
      ["var:SC0", ["SC0"]],
    ]);
    expect(units[1].kind).toBe("matrix");
    expect(units[1].questionText).toBe("Matrix");
  });

  it("skips the stacking Time variable", () => {
    const m = meta([v("Time", { role: "time", sources: [] }), ...VARS], { stacking: { time_variable: "Time", levels: [] } });
    expect(buildUnits(m).some((u) => u.names.includes("Time"))).toBe(false);
  });
});

describe("column stats and guesses", () => {
  it("counts distinct answers without missing codes", () => {
    expect(STATS.Q5_1).toMatchObject({ nDistinct: 3, nNonBlank: 3 });
    expect(STATS.Q4_1.distinct).toEqual(["A", "D"]);
  });

  const unit = (id: string) => buildUnits(M).find((u) => u.id === id)!;
  const vars = (u: Unit) => u.names.map((n) => byName.get(n)!);
  it.each([
    ["var:Q1", "group"],
    ["scale:scale_Q5", "likert_item"],
    ["multi:Q7", "demographic"],
    ["var:Q7_8_TEXT", "open_text"],
    ["group:Q4", "test_item"],
    ["var:SC0", "test_total"],
  ])("guesses %s as %s", (id, role) => {
    const u = unit(id);
    expect(guessRole(u, vars(u), STATS)).toBe(role);
  });

  it("guesses IDs from question text and scores from labels", () => {
    const id = v("Q1", { question_text: "Please enter your unique ID" });
    const stats = columnStats(["Q1"], [["AB01"], ["AB02"], ["ab01"], ["CD04"], ["EF05"]]);
    expect(guessRole({ id: "x", kind: "single", title: "Q1", names: ["Q1"], questionText: null }, [id], stats)).toBe("identifier");
    const score = v("Q4", { dtype: "float", level: "continuous", question_text: "Assessment score (0-100)" });
    expect(guessRole({ id: "y", kind: "single", title: "Q4", names: ["Q4"], questionText: null }, [score], {})).toBe("test_total");
  });

  it("derives the level from the role", () => {
    expect(guessLevel("likert_item", [likert("Q5_1")], STATS)).toBe("ordinal");
    expect(guessLevel("test_total", [byName.get("SC0")!], STATS)).toBe("continuous");
    expect(guessLevel("group", [byName.get("Q1")!], STATS)).toBe("nominal");
  });

  it("builds shared value labels from observed codes (sorted) or existing labels", () => {
    const q5 = buildUnits(M)[1];
    expect(initialLabels(q5, vars(q5), STATS)?.map((l) => l.value)).toEqual([1, 2, 4, 5]);
    expect(initialLabels(unit("var:Q1"), [byName.get("Q1")!], STATS)?.map((l) => l.value)).toEqual(["Control", "Treatment"]);
    expect(initialLabels(unit("multi:Q7"), vars(unit("multi:Q7")), STATS)).toBeNull();
  });
});

describe("steps", () => {
  const units = buildUnits(M);
  const labelsFor = (u: Unit) => initialLabels(u, u.names.map((n) => byName.get(n)!), STATS);
  const draft0 = initialDraft(M, units, STATS);

  it("starts from best guesses and lists every kind of step", () => {
    const steps = interviewSteps(units, draft0, byName, labelsFor);
    expect(steps[0]).toBe("intro");
    expect(steps.filter((s) => s.startsWith("role:"))).toHaveLength(units.length);
    expect(steps).toContain("level:var:Q1");
    expect(steps).not.toContain("level:group:Q4"); // test items: no level question
    expect(steps).toContain("labels:var:Q1");
    expect(steps).toContain("labels:scale:scale_Q5");
    expect(steps.slice(-4)).toEqual(["answer_key", "scales", "scoring", "summary"]);
  });

  it("drops later questions when an answer changes", () => {
    const d: Draft = {
      ...draft0,
      answers: {
        ...draft0.answers,
        "var:Q1": { ...draft0.answers["var:Q1"], role: "ignore" },
        "group:Q4": { ...draft0.answers["group:Q4"], role: "ignore" },
        "scale:scale_Q5": { ...draft0.answers["scale:scale_Q5"], role: "ignore" },
      },
    };
    const steps = interviewSteps(units, d, byName, labelsFor);
    expect(steps).not.toContain("level:var:Q1");
    expect(steps).not.toContain("labels:var:Q1");
    expect(steps).not.toContain("answer_key");
    expect(steps).not.toContain("scales");
    expect(steps).not.toContain("scoring");
  });

  it("blocks the answer-key step until one answer is set", () => {
    expect(stepProblem("answer_key", draft0, units, byName)).toMatch(/at least one correct answer/);
    expect(stepProblem("answer_key", { ...draft0, key: { Q4_1: ["A"] } }, units, byName)).toBeNull();
    expect(stepProblem("answer_key", { ...draft0, keyMode: "skip" }, units, byName)).toBeNull();
  });

  it("validates scales and minimums", () => {
    const one = moveItem(draft0.scales, "Q5_1", null);
    const d = { ...draft0, scales: [...one, { key: "n", id: null, name: "Two", items: ["Q5_1"], method: "mean" as const, minItems: null }] };
    expect(stepProblem("scales", d, units, byName)).toMatch(/at least two items/);
    const bad = { ...draft0, scales: draft0.scales.map((s) => ({ ...s, minItems: 9 })) };
    expect(stepProblem("scoring", bad, units, byName)).toMatch(/between 1 and 3/);
  });
});

describe("buildPlan", () => {
  const units = buildUnits(M);
  const labelsFor = (u: Unit) => initialLabels(u, u.names.map((n) => byName.get(n)!), STATS);
  const draft0 = initialDraft(M, units, STATS);

  it("sends only changed fields, reverse flags, scales with default minimum, and the key", () => {
    const d: Draft = { ...draft0, reverse: { Q5_2: true }, key: { Q4_1: ["A"], Q4_2: ["B"] } };
    const plan = buildPlan(M, units, d, labelsFor);
    const q1 = plan.updates.find((u) => u.name === "Q1")!;
    expect(q1).toEqual({ name: "Q1", role: "group", value_labels: [{ value: "Control", label: "Control" }, { value: "Treatment", label: "Treatment" }] });
    expect(plan.updates.find((u) => u.name === "Q5_2")).toMatchObject({ reverse_coded: true });
    expect(plan.updates.find((u) => u.name === "Q7_8_TEXT")).toBeUndefined(); // unchanged
    expect(plan.updates.find((u) => u.name === "SC0")).toBeUndefined();
    expect(plan.upsertScales).toEqual([{ id: "scale_Q5", name: "Q5", items: ["Q5_1", "Q5_2", "Q5_3"], scoring_method: "mean", min_items: 2 }]);
    expect(plan.deleteScales).toEqual([]);
    expect(plan.key).toEqual([{ item: "Q4_1", correct: ["A"] }, { item: "Q4_2", correct: ["B"] }]);
  });

  it("removes a scored scale the user dissolved and keeps Q7 indicators out of scales", () => {
    const m = meta(VARS, { scales: [{ ...M.scales[0], score_variable: "Q5_score" }] });
    const d: Draft = { ...draft0, scales: [], keyMode: "skip" };
    const plan = buildPlan(m, units, d, labelsFor);
    expect(plan.deleteScales).toEqual(["scale_Q5"]);
    expect(plan.upsertScales).toEqual([]);
    expect(plan.key).toBeNull();
    expect(plan.updates.filter((u) => u.name.startsWith("Q7_")).every((u) => !("reverse_coded" in u))).toBe(true);
  });

  it("scale helpers", () => {
    expect(defaultMinItems(6, "mean")).toBe(3);
    expect(defaultMinItems(5, "mean")).toBe(3);
    expect(defaultMinItems(4, "sum")).toBe(4);
    const moved = moveItem([{ key: "a", id: null, name: "A", items: ["x", "y"], method: "mean", minItems: null }, { key: "b", id: null, name: "B", items: ["z"], method: "mean", minItems: null }], "x", "b", 0);
    expect(moved.map((s) => s.items)).toEqual([["y"], ["x", "z"]]);
    expect(reorder([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(activeScales({ ...draft0, scales: moved }, units, byName)).toEqual([]);
  });
});
