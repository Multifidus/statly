import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepKnowledge } from "@/components/interview/InterviewSteps";
import type { DatasetMeta, SurveySuggestResult, VariableSchema } from "@/contracts";
import { buildUnits, columnStats, initialDraft } from "@/lib/interviewLogic";
import { pickAnswerKeyFile, pickExportPath } from "@/lib/dialogs";
import { rpc } from "@/lib/rpc";
import { useDatasetStore } from "@/stores/dataset";
import { applySurveySeed, surveyChoiceInfo, useInterview } from "@/stores/interview";

vi.mock("@/lib/dialogs", async (orig) => ({
  ...(await orig<typeof import("@/lib/dialogs")>()),
  pickAnswerKeyFile: vi.fn(),
  pickExportPath: vi.fn(),
}));

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

const META: DatasetMeta = {
  schema_version: 1,
  dataset_id: "ds",
  snapshot_id: "snap",
  n_rows: 5,
  row_id_column: "_statly_row_id",
  variables: [
    v("Student", { role: "identifier" }),
    v("K1", { question_text: "Capital of France?" }),
    v("K2", { question_text: "2 + 2?" }),
    v("Mood"),
  ].map((x, i) => ({ ...x, display_order: i })),
  scales: [],
  import_log: { files: [], row_filters: [], dropped_columns: [] },
  stacking: null,
  link: { mode: "aggregate", id_variable: null, normalization: null, counts: null },
  missing_summary: [],
};
const COLS = ["Student", "K1", "K2", "Mood"];
const ROWS = [
  ["s1", "Paris", "4", "Agree"],
  ["s2", "Rome", "5", "Disagree"],
  ["s3", "Paris", null, "Agree"],
  ["s4", "Oslo", "4", "Neutral"],
  ["s5", "Paris", "3", "Agree"],
];

const SURVEY: SurveySuggestResult = {
  survey_name: "Quiz",
  columns: [
    {
      name: "K1", survey_column: "K1", question_tag: "K1", label: "Capital of France?", question_text: "Capital of France?",
      value_labels: [{ value: 1, label: "Paris" }, { value: 2, label: "Rome" }, { value: 3, label: "Oslo" }],
      level: "nominal", question_kind: "single", correct_values: [1], notes: [], differs_from_current: [],
    },
  ],
  scales: [],
  unmatched: { survey_columns: [], dataset_columns: [] },
};

function setUp(withSurvey = false) {
  useDatasetStore.getState().setMeta(META);
  const units = buildUnits(META);
  const stats = columnStats(COLS, ROWS);
  let draft = initialDraft(META, units, stats);
  let filledFrom = useInterview.getState().filledFrom;
  if (withSurvey) ({ draft, filledFrom } = applySurveySeed(META, units, draft, SURVEY, "full", stats));
  useInterview.setState({
    units, stats, draft, filledFrom, survey: withSurvey ? surveyChoiceInfo(SURVEY) : {},
    step: "knowledge", status: "ready", datasetId: "ds", error: null, warnings: [],
  });
}

const row = (name: string) => screen.getByTestId(`knowledge-${name}`);
const draft = () => useInterview.getState().draft!;

beforeEach(() => {
  useDatasetStore.getState().clear();
  useInterview.getState().reset();
});
afterEach(() => vi.restoreAllMocks());

describe("StepKnowledge", () => {
  it("lists multiple-choice candidates with their answers and counts, not IDs or ratings", () => {
    setUp();
    render(<StepKnowledge />);
    expect(screen.getByText(/Some questions look like multiple choice/)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^knowledge-K/).map((x) => x.dataset.testid)).toEqual(["knowledge-K1", "knowledge-K2"]);
    expect(screen.queryByTestId("knowledge-Student")).toBeNull();
    expect(screen.queryByTestId("knowledge-Mood")).toBeNull();
    expect(within(row("K1")).getByText("Capital of France?")).toBeInTheDocument();
    expect(within(row("K1")).getByText(/Oslo \(1\) · Paris \(3\) · Rome \(1\)/)).toBeInTheDocument();
    expect(within(row("K1")).queryByRole("combobox")).toBeNull();
  });

  it("tick then pick the correct answer: the question becomes a test question with a key", async () => {
    setUp();
    const user = userEvent.setup();
    render(<StepKnowledge />);
    await user.click(screen.getByRole("checkbox", { name: "Knowledge question: K2" }));
    expect(draft().answers["var:K2"].role).toBe("test_item");
    const select = screen.getByRole("combobox", { name: "Correct answer for K2" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose the correct answer…", "3 (1)", "4 (2)", "5 (1)"]);
    await user.selectOptions(select, "4");
    expect(draft().key.K2).toEqual(["4"]);
    expect(screen.getByTestId("knowledge-total-rule")).toHaveTextContent(/more than half of the questions blank gets a blank total/);
    // Unticking clears the answer and gives the column its role back.
    await user.click(screen.getByRole("checkbox", { name: "Knowledge question: K2" }));
    expect(draft().key.K2).toBeUndefined();
    expect(draft().answers["var:K2"].role).toBe("group");
  });

  it("pre-ticks and pre-selects scored survey questions, marked as filled in from the survey", async () => {
    setUp(true);
    const user = userEvent.setup();
    render(<StepKnowledge />);
    expect(screen.getByRole("checkbox", { name: "Knowledge question: K1" })).toBeChecked();
    const select = screen.getByRole("combobox", { name: "Correct answer for K1" });
    expect(select).toHaveValue("Paris");
    expect(within(select).getByRole("option", { name: "Rome (1)" })).toBeInTheDocument();
    expect(screen.getByTestId("knowledge-filled-K1")).toHaveTextContent("Filled in from your survey");
    await user.selectOptions(select, "Rome");
    expect(screen.queryByTestId("knowledge-filled-K1")).toBeNull();
    expect(draft().key.K1).toEqual(["Rome"]);
  });

  it("Skip unticks everything, so the questions stay survey answers", async () => {
    setUp(true);
    const user = userEvent.setup();
    render(<StepKnowledge />);
    await user.click(screen.getByTestId("knowledge-skip"));
    expect(screen.getByRole("checkbox", { name: "Knowledge question: K1" })).not.toBeChecked();
    expect(draft().answers["var:K1"].role).not.toBe("test_item");
    expect(draft().key.K1).toBeUndefined();
    expect(useInterview.getState().filledFrom.knowledge).toEqual({});
  });

  it("loads a key file, reports what didn't match before using it, then fills the dropdowns", async () => {
    setUp();
    vi.mocked(pickAnswerKeyFile).mockResolvedValue("/tmp/key.xlsx");
    vi.spyOn(rpc, "parseAnswerKey").mockResolvedValue({
      entries: [
        { item: "K1", correct: ["paris"] },
        { item: "K2", correct: ["7"] },
        { item: "Q99", correct: ["A"] },
      ],
      warnings: [],
    });
    const user = userEvent.setup();
    render(<StepKnowledge />);
    await user.click(screen.getByRole("button", { name: /Load answer key/ }));
    const problems = await screen.findByTestId("key-problems");
    expect(problems).toHaveTextContent("1 question in the file isn't a multiple-choice question here: Q99.");
    expect(problems).toHaveTextContent("For K2, “7” isn't one of the answers people could choose.");
    expect(draft().key.K1).toBeUndefined(); // nothing applied yet
    await user.click(within(problems).getByRole("button", { name: "Use the matched answers" }));
    expect(screen.getByRole("combobox", { name: "Correct answer for K1" })).toHaveValue("Paris");
    expect(screen.getByRole("checkbox", { name: "Knowledge question: K1" })).toBeChecked();
    // Still editable after loading.
    await user.selectOptions(screen.getByRole("combobox", { name: "Correct answer for K1" }), "Oslo");
    expect(draft().key.K1).toEqual(["Oslo"]);
  });

  it("downloads an answer key template for the candidate questions", async () => {
    setUp();
    vi.mocked(pickExportPath).mockResolvedValue("/tmp/answer_key_template.xlsx");
    const spy = vi.spyOn(rpc, "answerKeyTemplate").mockResolvedValue({ path: "/tmp/answer_key_template.xlsx", n_items: 2 });
    const user = userEvent.setup();
    render(<StepKnowledge />);
    await user.click(screen.getByRole("button", { name: /Download answer key template/ }));
    expect(spy).toHaveBeenCalledWith({ dataset_id: "ds", snapshot_id: "snap", path: "/tmp/answer_key_template.xlsx", items: ["K1", "K2"] });
    expect(await screen.findByText(/Saved a template with 2 questions/)).toBeInTheDocument();
  });
});

describe("interview store: knowledge wiring", () => {
  it("setCorrect ticks the question, applyKey fills several, and the steps and plan follow", () => {
    setUp();
    const s = useInterview.getState();
    expect(s.steps()).toContain("knowledge");
    s.setCorrect("K2", "4");
    expect(draft().answers["var:K2"].role).toBe("test_item");
    useInterview.getState().applyKey({ K1: ["Paris"], Nope: ["A"] });
    expect(draft().key).toMatchObject({ K1: ["Paris"], K2: ["4"] });
    expect(useInterview.getState().steps()).not.toContain("answer_key");
    useInterview.getState().goTo("knowledge");
    expect(useInterview.getState().problem()).toBeNull();
    useInterview.getState().skipKnowledge();
    expect(draft().key).toEqual({});
  });
});
