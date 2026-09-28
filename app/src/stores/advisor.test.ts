import { beforeEach, describe, expect, it } from "vitest";
import type { DatasetMeta, VariableSchema } from "@/contracts";
import type { MockEngine } from "@/mocks/engine";
import { useFreshMock } from "@/test/mockTransport";
import { useAdvisor } from "@/stores/advisor";
import { useDatasetStore } from "@/stores/dataset";
import { useNav } from "@/stores/nav";
import { usePlanner } from "@/stores/planner";
import { useProjectStore } from "@/stores/project";

let engine: MockEngine;

const TO_T_INDEPENDENT: [string, string][] = [
  ["q_intent", "compare"],
  ["q_compare_outcome_level", "continuous"],
  ["q_compare_design", "independent_groups"],
  ["q_compare_between_groups_count", "two"],
];

/** Build and save a study plan into a fresh project, via the same design interview. */
async function saveStudyPlan() {
  const p = usePlanner.getState();
  p.setTitle("Reading study");
  p.setResearchQuestion("Does the reading program help?");
  await usePlanner.getState().beginInterview();
  for (const [q, v] of TO_T_INDEPENDENT) {
    await usePlanner.getState().answer(q, v);
  }
  usePlanner.getState().toPower();
  await usePlanner.getState().runPower();
  usePlanner.getState().toPlan();
  useProjectStore.getState().newProject("Reading study");
  useProjectStore.setState({ path: "/mock/projects/Reading study.statly" });
  await usePlanner.getState().savePlanToProject();
}

beforeEach(() => {
  engine = useFreshMock();
  usePlanner.getState().reset();
  useAdvisor.getState().reset();
  useDatasetStore.getState().clear();
  useNav.setState({ view: "advisor", prev: null });
  void engine;
});

function makeVariable(overrides: Partial<VariableSchema>): VariableSchema {
  return {
    schema_version: 1,
    name: "v",
    label: null,
    question_text: null,
    role: "unassigned",
    level: "continuous",
    dtype: "float",
    value_labels: [],
    reverse_coded: false,
    response_range: null,
    scale_id: null,
    missing_codes: [],
    sources: [],
    is_metadata: false,
    is_pii: false,
    pii_reason: null,
    computed: null,
    display_order: 0,
    ...overrides,
  };
}

/** A tiny dataset with a continuous score and a 5-point ordinal item, for the correlation branch
 * (QA-38 #39): value_labels on both so countLevels never needs the rows RPC. */
function correlationMeta(): DatasetMeta {
  const score = makeVariable({ name: "classroom_score", level: "continuous", value_labels: [{ value: 0, label: "0" }, { value: 100, label: "100" }] });
  const q6 = makeVariable({
    name: "Q6",
    level: "ordinal",
    value_labels: [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) })),
  });
  return {
    schema_version: 1,
    dataset_id: "d1",
    snapshot_id: "s1",
    n_rows: 113,
    row_id_column: "_statly_row_id",
    variables: [score, q6],
    scales: [],
    import_log: { files: [], row_filters: [], dropped_columns: [] },
    stacking: null,
    link: { mode: "aggregate", id_variable: null, normalization: null, counts: null },
    missing_summary: [
      { variable: "classroom_score", n_total: 113, n_valid: 110, n_missing_blank: 3, n_missing_coded: 0, pct_missing: 3 },
      { variable: "Q6", n_total: 113, n_valid: 113, n_missing_blank: 0, n_missing_coded: 0, pct_missing: 0 },
    ],
  };
}

describe("advisor store: startAnother (QA-38 #38)", () => {
  it("clears the explicit answers and shows the first question again, but keeps the chosen outcome", async () => {
    useDatasetStore.getState().setMeta(correlationMeta());
    await useAdvisor.getState().start("classroom_score");
    await useAdvisor.getState().answer("q_intent", "reliability");
    expect(useAdvisor.getState().step?.recommendation).not.toBeNull();

    await useAdvisor.getState().startAnother();

    const s = useAdvisor.getState();
    expect(s.outcome).toBe("classroom_score");
    expect(s.answers).toEqual({});
    expect(s.step?.next_question?.id).toBe("q_intent");
    expect(s.step?.recommendation).toBeNull();
  });
});

describe("advisor store: correlation second variable (QA-38 #39)", () => {
  it("blocks on q_relate_variable_types until a second variable is chosen, then derives real second_distinct/second_level", async () => {
    useDatasetStore.getState().setMeta(correlationMeta());
    await useAdvisor.getState().start("classroom_score");
    await useAdvisor.getState().answer("q_intent", "relate");

    // No second variable yet: the old bug's fallback (second_distinct = outcome_distinct) must
    // not silently apply. The advisor is parked on q_relate_variable_types with no second_level.
    expect(useAdvisor.getState().step?.next_question?.id).toBe("q_relate_variable_types");
    expect(useAdvisor.getState().secondVariable).toBeNull();
    expect(useAdvisor.getState().context.second_level).toBeUndefined();

    await useAdvisor.getState().setSecondVariable("Q6");

    const s = useAdvisor.getState();
    expect(s.secondVariable).toBe("Q6");
    expect(s.context.second_distinct).toBe(5);
    expect(s.context.second_level).toBe("ordinal");
  });

  it("auto-answers 'What kind of variables are you relating?' from both levels once the second variable is known, flagged as filled in from data", async () => {
    useDatasetStore.getState().setMeta(correlationMeta());
    await useAdvisor.getState().start("classroom_score"); // continuous
    await useAdvisor.getState().answer("q_intent", "relate");
    await useAdvisor.getState().setSecondVariable("Q6"); // ordinal -> "either ordinal" wins

    const s = useAdvisor.getState();
    const step = s.step!.path.find((p) => p.question === "q_relate_variable_types");
    expect(step?.value).toBe("ordinal_involved");
    expect(step?.source).toBe("user");
    expect(s.levelSeeded.q_relate_variable_types).toBe(true);

    // ...and the ties question after it auto-answers from the real second_distinct (5, a
    // 5-point item), not the classroom score's own distinct count, so the walk lands straight on
    // Kendall's tau-b rather than Spearman.
    const tiesStep = s.step!.path.find((p) => p.question === "q_relate_ordinal_detail");
    expect(tiesStep).toEqual({ question: "q_relate_ordinal_detail", value: "yes", source: "auto" });
    expect(s.step?.recommendation?.primary_test).toBe("correlation.kendall_tau_b");
  });

  it("explicit-answer-wins: changing the second variable again does not overwrite an answer the person already picked themselves", async () => {
    useDatasetStore.getState().setMeta(correlationMeta());
    await useAdvisor.getState().start("classroom_score");
    await useAdvisor.getState().answer("q_intent", "relate");
    await useAdvisor.getState().setSecondVariable("Q6");
    // The person overrides the auto-filled answer themselves.
    await useAdvisor.getState().answer("q_relate_variable_types", "continuous_continuous");
    expect(useAdvisor.getState().levelSeeded.q_relate_variable_types).toBeUndefined();

    await useAdvisor.getState().setSecondVariable("Q6"); // re-picking the same variable
    const step = useAdvisor.getState().step!.path.find((p) => p.question === "q_relate_variable_types");
    expect(step?.value).toBe("continuous_continuous");
    expect(useAdvisor.getState().levelSeeded.q_relate_variable_types).toBeUndefined();
  });
});

describe("advisor store: plan pre-fill hint", () => {
  it("marks answers seeded from a saved plan as planSeeded, and clears one once explicitly answered", async () => {
    await saveStudyPlan();

    await useAdvisor.getState().start(null);
    const s = useAdvisor.getState();
    expect(s.step?.path.length).toBeGreaterThan(0);
    // Every path entry came from the plan's answers, not the dataset (no dataset here).
    expect(s.step?.path.every((p) => p.source === "user")).toBe(true);
    for (const p of s.step!.path) expect(s.planSeeded[p.question]).toBe(true);

    // Explicitly re-answering one question clears its plan-seeded flag.
    const first = s.step!.path[0]!;
    await useAdvisor.getState().answer(first.question, first.value);
    expect(useAdvisor.getState().planSeeded[first.question]).toBeUndefined();
  });

  it("has no planSeeded answers when there is no saved plan in the project", async () => {
    useProjectStore.getState().newProject("No plan here");
    await useAdvisor.getState().start(null);
    expect(useAdvisor.getState().planSeeded).toEqual({});
  });

  it("Start over clears the plan seed (documented as a clean slate)", async () => {
    await saveStudyPlan();
    await useAdvisor.getState().start(null);
    expect(Object.keys(useAdvisor.getState().planSeeded).length).toBeGreaterThan(0);

    await useAdvisor.getState().start(null);
    expect(useAdvisor.getState().planSeeded).toEqual({});
    expect(useAdvisor.getState().step?.next_question?.id).toBe("q_intent");
  });
});
