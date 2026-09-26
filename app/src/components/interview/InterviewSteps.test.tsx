import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepLabels, StepScales, StepScoring } from "@/components/interview/InterviewSteps";
import type { DatasetMeta, Scale, VariableSchema } from "@/contracts";
import { activeScales, buildUnits, columnStats, initialDraft, stepProblem } from "@/lib/interviewLogic";
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

/** Load a 3-item Qualtrics matrix suggestion (Q5_1..Q5_3) as a scale, with a given stem and optional per-item overrides. */
function setUpScale(opts: { stem: string | null; itemOverrides?: (i: number) => Partial<VariableSchema>; scale?: Partial<Scale> } = { stem: "Classroom experience" }): void {
  const names = ["Q5_1", "Q5_2", "Q5_3"];
  const vars = names.map((name, i) =>
    v(name, {
      dtype: "integer",
      role: "likert_item",
      level: "ordinal",
      scale_id: "scale_Q5",
      response_range: { min: 1, max: 5 },
      question_text: opts.stem ? `${opts.stem} - ${name}` : null,
      ...(opts.itemOverrides?.(i) ?? {}),
    }),
  );
  const m = meta(vars);
  m.scales = [{ id: "scale_Q5", name: "Q5", items: names, scoring_method: "mean", min_items: null, score_variable: null, origin: "matrix_suggestion", ...opts.scale }];
  useDatasetStore.getState().setMeta(m);
  const units = buildUnits(m);
  const stats = columnStats(names, [
    [1, 2, 3],
    [2, 3, 4],
    [3, 4, 5],
  ]);
  const draft = initialDraft(m, units, stats);
  useInterview.setState({ units, stats, draft, step: "scales", status: "ready", datasetId: "ds", error: null, warnings: [] });
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

describe("StepScales: naming a suggested scale", () => {
  it("prefills the name from a short, non-instructional stem and shows the stem under the name field", () => {
    setUpScale({ stem: "Classroom experience" });
    render(<StepScales />);
    expect(screen.getByLabelText("Scale name")).toHaveValue("Classroom experience");
    expect(screen.getByTestId("scale-stem-scale_Q5")).toHaveTextContent("Classroom experience");
    expect(screen.queryByText("Give it a name you'd use in a report.")).not.toBeInTheDocument();
  });

  it("leaves the name blank with a hint and placeholder when the tag has no stem", () => {
    setUpScale({ stem: null });
    render(<StepScales />);
    const input = screen.getByLabelText("Scale name") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Name this scale, e.g. Classroom experience");
    expect(screen.getByText("Give it a name you'd use in a report.")).toBeInTheDocument();
  });

  it("does not prefill from a long, request-phrased stem (the real Qualtrics fixture text)", () => {
    setUpScale({ stem: "Please say how much you agree with each statement about your classroom experience" });
    render(<StepScales />);
    const input = screen.getByLabelText("Scale name") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Name this scale, e.g. Classroom experience");
    expect(screen.getByText("Give it a name you'd use in a report.")).toBeInTheDocument();
    // The stem is still shown under the name field, just not used as the prefilled name.
    expect(screen.getByTestId("scale-stem-scale_Q5")).toHaveTextContent(/please say how much you agree/i);
  });

  it("falls back to the tag on Continue when the name is left blank", () => {
    setUpScale({ stem: null });
    const { draft, units } = useInterview.getState();
    const byName = new Map(useDatasetStore.getState().meta!.variables.map((x: VariableSchema) => [x.name, x]));
    expect(stepProblem("scales", draft!, units, byName)).toBeNull();
    expect(activeScales(draft!, units, byName).map((s: { name: string }) => s.name)).toEqual(["Q5"]);
  });
});

describe("StepScales: reverse-wording marker", () => {
  it("auto-ticks and explains an item whose text carries a reverse marker", () => {
    setUpScale({
      stem: "Classroom experience",
      itemOverrides: (i) => (i === 1 ? { question_text: "Classroom experience - I dislike this class (reverse-worded)" } : {}),
    });
    render(<StepScales />);
    const marked = within(screen.getByTestId("scale-item-Q5_2"));
    expect(marked.getByRole("checkbox")).toBeChecked();
    expect(marked.getByTestId("reverse-hint-Q5_2")).toHaveTextContent(/reverse-worded/i);
    const unmarked = within(screen.getByTestId("scale-item-Q5_1"));
    expect(unmarked.getByRole("checkbox")).not.toBeChecked();
    expect(unmarked.queryByTestId("reverse-hint-Q5_1")).not.toBeInTheDocument();
  });
});

describe("StepScales: not-in-a-scale box", () => {
  it("explains that single questions belong there", () => {
    setUpScale({ stem: "Classroom experience" });
    render(<StepScales />);
    expect(screen.getByText(/single questions stay here/i)).toBeInTheDocument();
  });
});

describe("StepScoring: worked example", () => {
  it("shows a worked example for the average and sum options using the scale's item count", () => {
    setUpScale({ stem: "Classroom experience" });
    render(<StepScoring />);
    expect(screen.getByText(/example: answers 4, 5, 3 give an average of 4\.0/i)).toBeInTheDocument();
    expect(screen.getByText(/the same example gives 12/i)).toBeInTheDocument();
  });

  it("explains that under-answering yields a blank score, not a misleading one", () => {
    setUpScale({ stem: "Classroom experience" });
    render(<StepScoring />);
    expect(screen.getByText(/people who answered fewer get a blank score/i)).toBeInTheDocument();
  });
});
