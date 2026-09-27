import { describe, expect, it } from "vitest";
import type { DatasetMeta, VariableSchema } from "@/contracts";
import { suggestTestValue } from "@/lib/datasetContext";

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

function makeMeta(variables: VariableSchema[]): DatasetMeta {
  return {
    schema_version: 1,
    dataset_id: "d1",
    snapshot_id: "s1",
    n_rows: 0,
    row_id_column: "_statly_row_id",
    variables,
    scales: [],
    import_log: { files: [], row_filters: [], dropped_columns: [] },
    stacking: null,
    link: { mode: "aggregate", id_variable: null, normalization: null, counts: null },
    missing_summary: [],
  };
}

describe("suggestTestValue", () => {
  it("suggests the midpoint of a 1-5 scale from response_range", () => {
    const meta = makeMeta([makeVariable({ name: "score", response_range: { min: 1, max: 5 } })]);
    const s = suggestTestValue(meta, "score");
    expect(s).toEqual({ value: 3, note: expect.stringMatching(/middle of a 1–5 scale/) });
  });

  it("falls back to the span of value_labels' codes when response_range is absent", () => {
    const meta = makeMeta([
      makeVariable({
        name: "score",
        value_labels: [
          { value: 1, label: "Strongly disagree" },
          { value: 2, label: "Disagree" },
          { value: 3, label: "Neutral" },
          { value: 4, label: "Agree" },
        ],
      }),
    ]);
    const s = suggestTestValue(meta, "score");
    expect(s?.value).toBe(2.5);
  });

  it("returns null when there is nothing to derive a midpoint from", () => {
    const meta = makeMeta([makeVariable({ name: "score" })]);
    expect(suggestTestValue(meta, "score")).toBeNull();
    expect(suggestTestValue(meta, null)).toBeNull();
    expect(suggestTestValue(meta, "missing")).toBeNull();
  });
});
