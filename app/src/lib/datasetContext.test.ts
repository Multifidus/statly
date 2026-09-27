import { describe, expect, it } from "vitest";
import type { DatasetMeta, VariableSchema } from "@/contracts";
import { deriveDatasetContext, groupedOutcomeCandidates, outcomeCandidates, outcomeGroupOf } from "@/lib/datasetContext";

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

function makeMeta(overrides: Partial<DatasetMeta>): DatasetMeta {
  return {
    schema_version: 1,
    dataset_id: "d1",
    snapshot_id: "s1",
    n_rows: 0,
    row_id_column: "_statly_row_id",
    variables: [],
    scales: [],
    import_log: { files: [], row_filters: [], dropped_columns: [] },
    stacking: null,
    link: { mode: "aggregate", id_variable: null, normalization: null, counts: null },
    missing_summary: [],
    ...overrides,
  };
}

describe("deriveDatasetContext: n_complete / outcome_distinct / second_distinct", () => {
  it("sets n_complete from the outcome's missing_summary and outcome_distinct from its value labels", async () => {
    const outcome = makeVariable({
      name: "satisfaction",
      level: "ordinal",
      value_labels: [
        { value: 1, label: "Very dissatisfied" },
        { value: 2, label: "Dissatisfied" },
        { value: 3, label: "Neutral" },
        { value: 4, label: "Satisfied" },
        { value: 5, label: "Very satisfied" },
      ],
    });
    const meta = makeMeta({
      n_rows: 120,
      variables: [outcome],
      missing_summary: [{ variable: "satisfaction", n_total: 120, n_valid: 108, n_missing_blank: 12, n_missing_coded: 0, pct_missing: 10 }],
    });

    const ctx = await deriveDatasetContext(meta, "satisfaction");

    expect(ctx.n_complete).toBe(108);
    expect(ctx.outcome_distinct).toBe(5);
    // No second variable known yet at this point in the flow, so it falls back to the outcome's.
    expect(ctx.second_distinct).toBe(5);
  });

  it("leaves the fields undefined when there is no outcome", async () => {
    const meta = makeMeta({ n_rows: 10 });
    const ctx = await deriveDatasetContext(meta, null);
    expect(ctx.n_complete).toBeUndefined();
    expect(ctx.outcome_distinct).toBeUndefined();
    expect(ctx.second_distinct).toBeUndefined();
  });

  it("continuous outcome with many distinct values and a large complete sample: high distinct/n_complete", async () => {
    const outcome = makeVariable({ name: "score", level: "continuous", value_labels: [] });
    const meta = makeMeta({
      n_rows: 200,
      variables: [outcome],
      missing_summary: [{ variable: "score", n_total: 200, n_valid: 200, n_missing_blank: 0, n_missing_coded: 0, pct_missing: 0 }],
    });
    // No value_labels and no rows RPC available in this unit test; distinct count falls
    // back to reading rows, which isn't exercised here (see countLevels for that path).
    // We only assert n_complete here to keep this test free of an rpc mock.
    const ctx = await deriveDatasetContext({ ...meta, n_rows: 0 }, "score");
    expect(ctx.n_complete).toBe(200);
  });
});

describe("outcomeCandidates / groupedOutcomeCandidates: categorical outcomes", () => {
  const q2 = makeVariable({ name: "Q2", role: "group", level: "nominal", display_order: 1 });
  const q3 = makeVariable({ name: "Q3", label: "Did you pass the course?", role: "unassigned", level: "nominal", display_order: 2 });
  const q4 = makeVariable({ name: "Q4", label: "Did you use an extra-credit opportunity?", role: "unassigned", level: "nominal", display_order: 3 });
  const likert = makeVariable({ name: "Q5", role: "likert_item", level: "ordinal", display_order: 4 });
  const score = makeVariable({ name: "SC0", role: "scale_score", level: "continuous", display_order: 5 });
  const openEnded = makeVariable({ name: "Q9", role: "open_text", level: "nominal", display_order: 6 });
  const meta = makeMeta({ variables: [q2, q3, q4, likert, score, openEnded] });

  it("includes categorical (yes/no, nominal) variables as outcome candidates, not just scores/ratings", () => {
    const names = outcomeCandidates(meta).map((v) => v.name);
    expect(names).toContain("Q3");
    expect(names).toContain("Q4");
  });

  it("excludes the group role and free-text (open_text) from outcome candidates", () => {
    const names = outcomeCandidates(meta).map((v) => v.name);
    expect(names).not.toContain("Q2");
    expect(names).not.toContain("Q9");
  });

  it("groups a nominal nominal variable under 'categories', a likert item under 'ratings', and a scale score under 'scores'", () => {
    expect(outcomeGroupOf(q3)).toBe("categories");
    expect(outcomeGroupOf(likert)).toBe("ratings");
    expect(outcomeGroupOf(score)).toBe("scores");
  });

  it("builds dropdown optgroups in order (Scores, Ratings and Likert items, Yes/no and categories, Other), omitting empty groups", () => {
    const groups = groupedOutcomeCandidates(meta);
    expect(groups.map((g) => g.group)).toEqual(["scores", "ratings", "categories"]);
    const categories = groups.find((g) => g.group === "categories")!;
    expect(categories.label).toBe("Yes/no and categories");
    expect(categories.variables.map((v) => v.name)).toEqual(["Q3", "Q4"]);
  });
});
