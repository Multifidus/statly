import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult } from "@/contracts";
import example from "../../../../contracts/examples/AnalysisResult.json";
import { ResultsView } from "@/components/results/ResultsView";
import { richToPlain } from "@/lib/apa";

// Captured from the real engine by src/integration/analysis.engine.test.ts (STATLY_CAPTURE=1).
const REAL = Object.values(
  import.meta.glob("../../test/fixtures/realTTestIndependent.json", { eager: true, import: "default" }),
)[0] as AnalysisResult | undefined;

class FakeClipboardItem {
  constructor(public items: Record<string, Blob>) {}
}

let written: FakeClipboardItem[][] = [];
beforeEach(() => {
  written = [];
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write: vi.fn(async (items: FakeClipboardItem[]) => void written.push(items)), writeText: vi.fn() },
  });
});
afterEach(() => vi.unstubAllGlobals());

async function blobText(b: Blob): Promise<string> {
  return typeof b.text === "function" ? b.text() : new Response(b).text();
}

function checkGeneric(result: AnalysisResult) {
  render(<ResultsView result={result} title="Independent-samples t test" />);
  const view = screen.getByTestId("results-view");
  // Plain-language summary comes before the APA output.
  const summary = screen.getByTestId("plain-summary");
  expect(summary).toHaveTextContent(result.plain_language_summary);
  const sentence = screen.getByTestId("apa-sentence");
  expect(summary.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(sentence.textContent).toBe(richToPlain(result.apa_sentence));
  const italics = [...sentence.querySelectorAll("i")].map((i) => i.textContent);
  expect(italics).toEqual(result.apa_sentence.filter((r) => r.italic).map((r) => r.text));
  // APA table: number, italic title, one row per data row.
  const table = screen.getByTestId("apa-table");
  expect(within(table).getByText(result.apa_table!.title)).toHaveClass("italic");
  expect(within(table).getAllByRole("row").length).toBeGreaterThanOrEqual(result.apa_table!.rows.length + 1);
  // Effect sizes with interpretation, every assumption, descriptives, How to report this.
  for (const e of result.effect_sizes.filter((x) => x.interpretation)) expect(view).toHaveTextContent(e.interpretation!.text);
  expect(within(screen.getByTestId("result-assumptions")).getAllByRole("listitem")).toHaveLength(result.assumptions.length);
  expect(within(within(screen.getByTestId("result-descriptives")).getAllByRole("table")[0]).getAllByRole("row")).toHaveLength(result.descriptives.continuous.length + 1);
  expect(screen.getByTestId("result-how-to-report")).toHaveTextContent(/Template/);
  expect(screen.getByTestId("open-learn-page")).toHaveTextContent(/Independent-samples t-test/);
  return view;
}

describe("ResultsView", () => {
  it("renders contracts/examples/AnalysisResult.json generically", () => {
    const result = example as unknown as AnalysisResult;
    checkGeneric(result);
    expect(screen.getByTestId("result-warnings")).toHaveTextContent(result.warnings[0].message);
    // Headline: the preferred effect size for t_test.independent (Hedges' g) with its CI.
    expect(screen.getByTestId("result-summary")).toHaveTextContent("g = 0.72, 95% CI [0.08, 1.35]");
    expect(screen.getByTestId("result-summary")).toHaveTextContent(/p = \.026/);
  });

  it.runIf(!!REAL)("renders a real t_test.independent result captured from the engine", () => {
    const result = REAL!;
    expect(result.analysis_id).toBe("t_test.independent");
    checkGeneric(result);
    expect(screen.getByTestId("result-summary")).toHaveTextContent(/Welch's t/);
  });

  it("copies the APA sentence as rich HTML + plain text", async () => {
    const result = example as unknown as AnalysisResult;
    render(<ResultsView result={result} title="t test" />);
    await userEvent.click(screen.getByTestId("copy-sentence"));
    await waitFor(() => expect(written).toHaveLength(1));
    const item = written[0][0];
    expect(Object.keys(item.items).sort()).toEqual(["text/html", "text/plain"]);
    expect(await blobText(item.items["text/plain"])).toBe(richToPlain(result.apa_sentence));
    expect(await blobText(item.items["text/html"])).toContain("<i>t</i>(37.4) = 2.31, <i>p</i> = .026");
    expect(screen.getByTestId("copy-sentence")).toHaveTextContent("Copied");
  });

  it("copies the APA table as HTML", async () => {
    render(<ResultsView result={example as unknown as AnalysisResult} title="t test" />);
    await userEvent.click(screen.getByTestId("apa-table-copy"));
    await waitFor(() => expect(written).toHaveLength(1));
    const html = await blobText(written[0][0].items["text/html"]);
    expect(html).toContain("<table");
    expect(html).toContain("Math Attitude by Condition at Posttest");
  });

  it("mounts a Save figure… button on the assumption's chart (SPEC §10.3)", () => {
    const result = example as unknown as AnalysisResult;
    render(<ResultsView result={result} title="t test" />);
    const assumptions = screen.getByTestId("result-assumptions");
    expect(within(assumptions).getByTestId("chart-qq")).toBeInTheDocument();
    expect(within(assumptions).getByTestId("save-figure")).toBeInTheDocument();
  });

  it("shows 'Run Fisher's exact test instead' on chi-square's low_expected_counts warning and fires onRunFisher", async () => {
    const base = structuredClone(example) as unknown as AnalysisResult;
    const result: AnalysisResult = {
      ...base,
      analysis_id: "chi_square.independence",
      warnings: [{ code: "low_expected_counts", severity: "caution", message: "25% of the cells have an expected count below 5 (smallest 3.30)." }],
    };
    const onRunFisher = vi.fn();
    render(<ResultsView result={result} title="Chi-square test of independence" onRunFisher={onRunFisher} />);
    const button = screen.getByTestId("run-fisher-instead");
    expect(within(screen.getByTestId("result-warnings")).getByText(/smallest 3.30/)).toBeInTheDocument();
    await userEvent.click(button);
    expect(onRunFisher).toHaveBeenCalledTimes(1);
  });

  it("does not show the Fisher button for other warning codes or other analyses", () => {
    const base = structuredClone(example) as unknown as AnalysisResult;
    const otherCode: AnalysisResult = { ...base, analysis_id: "chi_square.independence", warnings: [{ code: "small_sample", severity: "caution", message: "Only 12 people are in the table." }] };
    const { unmount } = render(<ResultsView result={otherCode} title="x" onRunFisher={vi.fn()} />);
    expect(screen.queryByTestId("run-fisher-instead")).toBeNull();
    unmount();

    const otherAnalysis: AnalysisResult = { ...base, analysis_id: "fisher_exact", warnings: [{ code: "low_expected_counts", severity: "caution", message: "..." }] };
    render(<ResultsView result={otherAnalysis} title="x" onRunFisher={vi.fn()} />);
    expect(screen.queryByTestId("run-fisher-instead")).toBeNull();
  });

  it("does not show the Fisher button when no onRunFisher handler is passed", () => {
    const base = structuredClone(example) as unknown as AnalysisResult;
    const result: AnalysisResult = { ...base, analysis_id: "chi_square.independence", warnings: [{ code: "low_expected_counts", severity: "caution", message: "..." }] };
    render(<ResultsView result={result} title="x" />);
    expect(screen.queryByTestId("run-fisher-instead")).toBeNull();
  });

  it("renders bare _subscripts as <sub> instead of literal underscores, in the summary, the chip and the effect-size list (QA #35)", () => {
    const base = structuredClone(example) as unknown as AnalysisResult;
    const result: AnalysisResult = {
      ...base,
      analysis_id: "t_test.paired",
      plain_language_summary: "The difference was small (Cohen's d_av = -0.29).",
      effect_sizes: [
        { key: "d_av", label: "Cohen's d_av", symbol: "d_av", value: -0.29, ci: null, term: null, interpretation: null, headline: true },
        { key: "d_z", label: "Cohen's d_z", symbol: "d_z", value: -0.69, ci: null, term: null, interpretation: null },
      ],
    };
    render(<ResultsView result={result} title="Paired-samples t test" />);

    const summary = screen.getByTestId("plain-summary");
    expect(summary.textContent).toBe("The difference was small (Cohen's dav = -0.29).");
    expect(summary.querySelector("sub")?.textContent).toBe("av");

    // Headline chip: picks the flagged d_av entry, and renders its heading + symbol with a <sub>.
    const chip = screen.getByTestId("result-summary");
    const chipSubs = [...within(chip).getAllByText("av", { selector: "sub" })];
    expect(chipSubs.length).toBeGreaterThanOrEqual(2); // heading "d_av" + symbol "d_av"

    // Effect-size list: both d_av and d_z headings render with a <sub>, not a literal underscore.
    const list = screen.getByTestId("result-effects");
    expect(list.textContent).not.toMatch(/d_av|d_z/);
    expect(within(list).getAllByText("av", { selector: "sub" }).length).toBeGreaterThan(0);
    expect(within(list).getAllByText("z", { selector: "sub" }).length).toBeGreaterThan(0);
  });
});
