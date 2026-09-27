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
  hasReverseMarker,
  initialDraft,
  initialLabels,
  interviewSteps,
  isKnowledge,
  isNameableStem,
  itemStatement,
  knowledgeCandidates,
  resolveKeyFile,
  setKnowledge,
  testItems,
  moveItem,
  reorder,
  scoringExample,
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
    const d = {
      ...draft0,
      scales: [...one, { key: "n", id: null, name: "Two", placeholderName: null, items: ["Q5_1"], method: "mean" as const, minItems: null }],
    };
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
    // Q5's items carry question_text "Matrix - Q5_1" etc., so the suggested "Q5" tag is prefilled from the shared stem.
    expect(plan.upsertScales).toEqual([{ id: "scale_Q5", name: "Matrix", items: ["Q5_1", "Q5_2", "Q5_3"], scoring_method: "mean", min_items: 2 }]);
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
    const moved = moveItem(
      [
        { key: "a", id: null, name: "A", placeholderName: null, items: ["x", "y"], method: "mean", minItems: null },
        { key: "b", id: null, name: "B", placeholderName: null, items: ["z"], method: "mean", minItems: null },
      ],
      "x",
      "b",
      0,
    );
    expect(moved.map((s) => s.items)).toEqual([["y"], ["x", "z"]]);
    expect(reorder([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(activeScales({ ...draft0, scales: moved }, units, byName)).toEqual([]);
  });
});

describe("scale name prefill and placeholder fallback", () => {
  it("prefills a matrix suggestion's name from the shared stem when question text has one", () => {
    const units = buildUnits(M);
    const draft = initialDraft(M, units, STATS);
    const q5 = draft.scales.find((s) => s.id === "scale_Q5")!;
    expect(q5.name).toBe("Matrix");
    expect(q5.placeholderName).toBe("Q5");
  });

  it("leaves the name blank with the tag as placeholder when no stem is available", () => {
    const noStemVars = VARS.map((x) => (x.name.startsWith("Q5_") ? { ...x, question_text: null } : x));
    const m = meta(noStemVars);
    const units = buildUnits(m);
    const draft = initialDraft(m, units, STATS);
    const q5 = draft.scales.find((s) => s.id === "scale_Q5")!;
    expect(q5.name).toBe("");
    expect(q5.placeholderName).toBe("Q5");
  });

  it("does not block Continue on a blank name, and falls back to the tag when building the plan", () => {
    const noStemVars = VARS.map((x) => (x.name.startsWith("Q5_") ? { ...x, question_text: null } : x));
    const m = meta(noStemVars);
    const units = buildUnits(m);
    const labelsFor = (u: Unit) => initialLabels(u, u.names.map((n) => new Map(m.variables.map((v) => [v.name, v])).get(n)!), STATS);
    const draft = initialDraft(m, units, STATS);
    expect(stepProblem("scales", draft, units, new Map(m.variables.map((v) => [v.name, v])))).toBeNull();
    const plan = buildPlan(m, units, draft, labelsFor);
    expect(plan.upsertScales).toEqual([{ id: "scale_Q5", name: "Q5", items: ["Q5_1", "Q5_2", "Q5_3"], scoring_method: "mean", min_items: 2 }]);
  });

  it("does not treat a user-renamed scale (non-tag name) as an auto tag", () => {
    const m = meta(VARS, { scales: [{ ...M.scales[0], name: "Classroom experience", origin: "user" }] });
    const units = buildUnits(m);
    const draft = initialDraft(m, units, STATS);
    const q5 = draft.scales.find((s) => s.id === "scale_Q5")!;
    expect(q5.name).toBe("Classroom experience");
    expect(q5.placeholderName).toBeNull();
  });

  it("does not prefill from the real fixture's long, request-phrased stem", () => {
    const requestStemVars = VARS.map((x) =>
      x.name.startsWith("Q5_")
        ? { ...x, question_text: `Please say how much you agree with each statement about your classroom experience - ${x.name}` }
        : x,
    );
    const m = meta(requestStemVars);
    const units = buildUnits(m);
    const draft = initialDraft(m, units, STATS);
    const q5 = draft.scales.find((s) => s.id === "scale_Q5")!;
    expect(q5.name).toBe("");
    expect(q5.placeholderName).toBe("Q5");
  });

  it("prefills from a short stem that isn't a request phrase", () => {
    const shortStemVars = VARS.map((x) => (x.name.startsWith("Q5_") ? { ...x, question_text: `Classroom experience - ${x.name}` } : x));
    const m = meta(shortStemVars);
    const units = buildUnits(m);
    const draft = initialDraft(m, units, STATS);
    const q5 = draft.scales.find((s) => s.id === "scale_Q5")!;
    expect(q5.name).toBe("Classroom experience");
    expect(q5.placeholderName).toBe("Q5");
  });
});

describe("isNameableStem", () => {
  it("accepts short, non-instructional stems and rejects long or request-phrased ones", () => {
    expect(isNameableStem("Classroom experience")).toBe(true);
    expect(isNameableStem("Please say how much you agree with each statement about your classroom experience")).toBe(false);
    expect(isNameableStem("Rate your agreement")).toBe(false);
    expect(isNameableStem("How satisfied are you with the course")).toBe(false);
    expect(isNameableStem(null)).toBe(false);
  });
});

describe("reverse-wording markers", () => {
  it("auto-ticks reverse for items whose text carries a reverse marker", () => {
    const marked = [
      v("StartDate", { is_metadata: true }),
      likert("Q5_1"),
      { ...likert("Q5_2"), question_text: "Matrix - I dislike this class (reverse-worded)" },
      likert("Q5_3"),
    ];
    const m = meta(marked);
    const units = buildUnits(m);
    const draft = initialDraft(m, units, STATS);
    expect(draft.reverse["Q5_2"]).toBe(true);
    expect(draft.reverse["Q5_1"]).toBeUndefined();
  });

  it("only matches explicit markers, not sentiment", () => {
    expect(hasReverseMarker("I dislike this class")).toBe(false);
    expect(hasReverseMarker("I dislike this class (reverse-worded)")).toBe(true);
    expect(hasReverseMarker("Enjoyment (reversed)")).toBe(true);
    expect(hasReverseMarker("Enjoyment (R)")).toBe(true);
  });
});

describe("itemStatement", () => {
  it("strips a shared stem already shown on the scale card", () => {
    expect(itemStatement("Matrix - I enjoy this class", "Matrix")).toBe("I enjoy this class");
  });
  it("returns the full text when there is no matching stem", () => {
    expect(itemStatement("I enjoy this class", null)).toBe("I enjoy this class");
    expect(itemStatement(null, "Matrix")).toBeNull();
  });
});

describe("scoringExample", () => {
  it("computes a worked example padded/trimmed to the item count", () => {
    expect(scoringExample(6)).toEqual({ values: [4, 5, 3, 2, 5, 4], sum: 23, average: 3.8 });
    expect(scoringExample(3)).toEqual({ values: [4, 5, 3], sum: 12, average: 4 });
  });
});

describe("knowledge questions", () => {
  const KV = [
    v("id", { role: "identifier" }),
    v("K1", { question_text: "Capital of France?" }),
    v("K2"),
    v("Rate", {}),
    v("Many"),
    v("Code", { dtype: "integer" }),
    v("Done", { dtype: "integer" }),
    v("Lik", { dtype: "integer", level: "ordinal", value_labels: [{ value: 1, label: "Low" }, { value: 2, label: "High" }] }),
    v("Q8_1"),
    v("Q8_2"),
    v("K1_TEXT"),
  ];
  const KM = meta(KV, { scales: [] });
  const kByName = new Map(KM.variables.map((x) => [x.name, x]));
  const cols = ["id", "K1", "K2", "Rate", "Many", "Code", "Done", "Lik", "Q8_1", "Q8_2", "K1_TEXT"];
  const rows = [
    ["a1", "Paris", "B", "Agree", "1", 1, 0, 1, "A", "C", "x"],
    ["a2", "Rome", "B", "Disagree", "2", 2, 1, 2, "B", "C", "y"],
    ["a3", "Paris", null, "Agree", "3", 3, 1, 1, "A", "D", "z"],
    ["a4", "Oslo", "C", "Neutral", "4", 4, 0, 2, "C", "C", "w"],
  ];
  // "Many" has 9 different answers once the extra rows are added.
  const more = ["5", "6", "7", "8", "9"].map((x) => ["b" + x, "Paris", "B", "Agree", x, 1, 0, 1, "A", "C", null]);
  const kStats = columnStats(cols, [...rows, ...more]);
  const kUnits = buildUnits(KM);
  const kDraft = initialDraft(KM, kUnits, kStats);

  it("detects short-choice columns and skips IDs, ratings, 0/1 scores, many-answer and text columns", () => {
    const c = knowledgeCandidates(kUnits, kDraft, kByName, kStats);
    expect(c.map((x) => x.name)).toEqual(["K1", "K2", "Code", "Q8_1", "Q8_2"]);
    const k1 = c.find((x) => x.name === "K1")!;
    expect(k1.questionText).toBe("Capital of France?");
    expect(k1.choices.map((x) => [x.value, x.count])).toEqual([["Oslo", 1], ["Paris", 7], ["Rome", 1]]);
    expect(c.find((x) => x.name === "Code")!.choices.map((x) => x.value)).toEqual(["1", "2", "3", "4"]);
  });

  it("uses the survey: single-answer choices (with codes) qualify, other kinds never do, and scoring gives the answer", () => {
    const survey = {
      K1: { kind: "single", choices: [{ value: 1, label: "Paris" }, { value: 2, label: "Rome" }, { value: 3, label: "Oslo" }, { value: 4, label: "Bern" }], correct: [1] },
      K2: { kind: "matrix", choices: [], correct: [] },
      Lik: { kind: "single", choices: [{ value: 1, label: "Low" }, { value: 2, label: "High" }], correct: [2] },
    };
    const c = knowledgeCandidates(kUnits, kDraft, kByName, kStats, survey);
    // Lik is guessed a Likert item (ordered, labelled): never a knowledge question, even when scored.
    expect(c.map((x) => x.name)).toEqual(["K1", "Code", "Q8_1", "Q8_2"]);
    const k1 = c.find((x) => x.name === "K1")!;
    expect(k1.choices.map((x) => [x.value, x.code, x.count])).toEqual([["Paris", "1", 7], ["Rome", "2", 1], ["Oslo", "3", 1], ["Bern", "4", 0]]);
    expect(k1.surveyCorrect).toEqual(["Paris"]);
    // Labelled codes show code = wording.
    const lab = knowledgeCandidates(kUnits, kDraft, kByName, kStats, { Code: { kind: "single", choices: [{ value: 1, label: "One" }], correct: [] } });
    expect(lab.find((x) => x.name === "Code")!.choices.map((x) => [x.value, x.label])).toEqual([["1", "One"], ["2", null], ["3", null], ["4", null]]);
  });

  it("ticking makes a test question; one part of a family can be ticked alone; unticking restores the role", () => {
    const c = knowledgeCandidates(kUnits, kDraft, kByName, kStats);
    const k1 = c.find((x) => x.name === "K1")!;
    expect(kDraft.answers["var:K1"].role).toBe("group");
    expect(isKnowledge(kDraft, k1)).toBe(false);
    let d = setKnowledge(kDraft, kUnits, k1, true);
    expect(d.answers["var:K1"]).toMatchObject({ role: "test_item", level: "nominal" });
    expect(isKnowledge(d, k1)).toBe(true);
    d = { ...d, key: { K1: ["Paris"] } };
    d = setKnowledge(d, kUnits, k1, false);
    expect(d.answers["var:K1"].role).toBe("group");
    expect(d.key.K1).toBeUndefined();

    // Q8_1/Q8_2 are one Qn_k family, already guessed as test questions: both start ticked.
    const q81 = c.find((x) => x.name === "Q8_1")!;
    const q82 = c.find((x) => x.name === "Q8_2")!;
    expect(kDraft.answers["group:Q8"].role).toBe("test_item");
    expect(isKnowledge(kDraft, q81) && isKnowledge(kDraft, q82)).toBe(true);
    d = setKnowledge(kDraft, kUnits, q82, false);
    expect(isKnowledge(d, q81)).toBe(true);
    expect(isKnowledge(d, q82)).toBe(false);
    d = setKnowledge(d, kUnits, q81, false);
    expect(d.answers["group:Q8"].role).toBe("demographic");
    // Ticking one part of a family that wasn't a test leaves the other part unticked.
    d = setKnowledge(d, kUnits, q82, true);
    expect(isKnowledge(d, q82)).toBe(true);
    expect(isKnowledge(d, q81)).toBe(false);
  });

  it("puts the step after 'Kinds of answers', skips the answer-key step for its questions, and always scores its answers", () => {
    const labelsFor = (u: Unit) => initialLabels(u, u.names.map((n) => kByName.get(n)!), kStats);
    const c = knowledgeCandidates(kUnits, kDraft, kByName, kStats);
    const names = new Set(c.map((x) => x.name));
    const steps = interviewSteps(kUnits, kDraft, kByName, labelsFor, c);
    const at = steps.indexOf("knowledge");
    expect(at).toBeGreaterThan(steps.map((x) => x.startsWith("level:")).lastIndexOf(true));
    expect(at).toBeLessThan(steps.findIndex((x) => x.startsWith("labels:")));
    expect(steps).not.toContain("answer_key");
    // Without candidates the old answer-key step is back for the raw Q8 test questions.
    expect(interviewSteps(kUnits, kDraft, kByName, labelsFor)).toContain("answer_key");

    let d = setKnowledge(kDraft, kUnits, c.find((x) => x.name === "Code")!, true);
    d = { ...d, key: { Code: ["2"], Q8_1: ["A"] }, keyMode: "skip" };
    expect(testItems(kUnits, d, kByName, names).raw).toEqual(["Code", "Q8_1", "Q8_2"]);
    expect(stepProblem("answer_key", { ...d, keyMode: "key", key: {} }, kUnits, kByName, names)).toBeNull();
    const plan = buildPlan(KM, kUnits, d, labelsFor, names);
    expect(plan.key).toEqual([{ item: "Code", correct: ["2"] }, { item: "Q8_1", correct: ["A"] }]);
    expect(plan.updates.find((u) => u.name === "Code")).toMatchObject({ role: "test_item" });
  });

  it("resolves a loaded key by wording (any case) or code and reports what it can't use", () => {
    const survey = { K1: { kind: "single", choices: [{ value: 1, label: "Paris" }, { value: 2, label: "Rome" }], correct: [] } };
    const c = knowledgeCandidates(kUnits, kDraft, kByName, kStats, survey);
    const r = resolveKeyFile(
      [
        { item: "K1", correct: ["paris"] },
        { item: "k2", correct: ["c"] },
        { item: "Code", correct: [3] },
        { item: "Q8_1", correct: ["2"] },
        { item: "Nope", correct: ["A"] },
      ],
      c,
    );
    expect(r.key).toEqual({ K1: ["Paris"], K2: ["C"], Code: ["3"] });
    expect(r.unknownQuestions).toEqual(["Nope"]);
    expect(r.unknownAnswers).toEqual([{ item: "Q8_1", answer: "2" }]);
    // A key in codes works too when the survey gives them.
    expect(resolveKeyFile([{ item: "K1", correct: ["2"] }], c).key).toEqual({ K1: ["Rome"] });
  });

  it("columnStats counts each answer", () => {
    expect(kStats.K1.counts).toEqual({ Paris: 7, Rome: 1, Oslo: 1 });
  });
});
