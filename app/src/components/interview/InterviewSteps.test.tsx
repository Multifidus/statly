import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepLabels } from "@/components/interview/InterviewSteps";
import type { DatasetMeta, VariableSchema } from "@/contracts";
import { buildUnits, columnStats, initialDraft } from "@/lib/interviewLogic";
import { useDatasetStore } from "@/stores/dataset";
import { useInterview } from "@/stores/interview";

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

function meta(vars: VariableSchema[]): DatasetMeta {
  return {
    schema_version: 1,
    dataset_id: "ds",
    snapshot_id: "snap",
    n_rows: 5,
    row_id_column: "_statly_row_id",
    variables: vars.map((x, i) => ({ ...x, display_order: i })),
    scales: [],
    import_log: { files: [], row_filters: [], dropped_columns: [] },
    stacking: null,
    link: { mode: "aggregate", id_variable: null, normalization: null, counts: null },
    missing_summary: [],
  };
}

/** Load one likert unit (numeric, single item) into the interview store and return its unit id. */
function setUpUnit(variable: VariableSchema, values: number[]): string {
  const m = meta([v("Q1", variable)]);
  useDatasetStore.getState().setMeta(m);
  const units = buildUnits(m);
  const stats = columnStats(["Q1"], values.map((n) => [n]));
  const draft = initialDraft(m, units, stats);
  useInterview.setState({ units, stats, draft, step: `labels:${units[0].id}`, status: "ready", datasetId: "ds", error: null, warnings: [] });
  return units[0].id;
}

beforeEach(() => {
  useDatasetStore.getState().clear();
  useInterview.getState().reset();
});

describe("StepLabels: numeric-coded export with no text labels", () => {
  it("shows the plain-language explanation instead of the drag instruction", () => {
    const unitId = setUpUnit(v("Q1", { dtype: "integer", role: "likert_item", level: "ordinal" }), [1, 2, 3, 4, 5]);
    render(<StepLabels unitId={unitId} />);
    expect(screen.getByTestId("numeric-codes-notice")).toHaveTextContent(/tell statly what each number meant/i);
    expect(screen.queryByText(/put the answer choices in their natural order/i)).not.toBeInTheDocument();
  });

  it("offers 5-point presets and applying one fills the labels without changing codes", async () => {
    const user = userEvent.setup();
    const unitId = setUpUnit(v("Q1", { dtype: "integer", role: "likert_item", level: "ordinal" }), [1, 2, 3, 4, 5]);
    render(<StepLabels unitId={unitId} />);
    await user.click(screen.getByRole("button", { name: "Agreement" }));
    const rows = screen.getAllByTestId("value-label-row");
    expect(rows.map((r) => r.querySelector("code")!.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    expect(rows.map((r) => (r.querySelector("input") as HTMLInputElement).value)).toEqual([
      "Strongly disagree",
      "Disagree",
      "Neither agree nor disagree",
      "Agree",
      "Strongly agree",
    ]);
    // "Yes/No" only applies to 2-point scales, so it's not offered here.
    expect(screen.queryByRole("button", { name: "Yes/No" })).not.toBeInTheDocument();
  });

  it("keeps codes attached to their rows when the observed codes run high-to-low", async () => {
    const user = userEvent.setup();
    // The export's own value_labels already list the codes high-to-low (numbers only, no text).
    const unitId = setUpUnit(
      v("Q1", {
        dtype: "integer",
        role: "likert_item",
        level: "ordinal",
        value_labels: [5, 4, 3, 2, 1].map((n) => ({ value: n, label: String(n) })),
      }),
      [5, 4, 3, 2, 1],
    );
    render(<StepLabels unitId={unitId} />);
    await user.click(screen.getByRole("button", { name: "Agreement" }));
    const rows = screen.getAllByTestId("value-label-row");
    expect(rows.map((r) => r.querySelector("code")!.textContent)).toEqual(["5", "4", "3", "2", "1"]);
    expect((rows[0].querySelector("input") as HTMLInputElement).value).toBe("Strongly agree");
    expect((rows[4].querySelector("input") as HTMLInputElement).value).toBe("Strongly disagree");
  });
});

describe("StepLabels: export already has text labels", () => {
  it("keeps the original instruction and skips the numeric-codes notice", () => {
    const unitId = setUpUnit(
      v("Q1", {
        dtype: "integer",
        role: "likert_item",
        level: "ordinal",
        value_labels: [
          { value: 1, label: "Strongly disagree" },
          { value: 2, label: "Disagree" },
          { value: 3, label: "Neutral" },
          { value: 4, label: "Agree" },
          { value: 5, label: "Strongly agree" },
        ],
      }),
      [1, 2, 3, 4, 5],
    );
    render(<StepLabels unitId={unitId} />);
    expect(screen.queryByTestId("numeric-codes-notice")).not.toBeInTheDocument();
    expect(screen.getByText(/put the answer choices in their natural order/i)).toBeInTheDocument();
  });
});
