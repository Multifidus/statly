import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DatasetImportPreviewResult, FilePreview, ImportIssue } from "@/contracts";
import { StepDetect } from "@/components/import/StepDetect";
import { defaultDecisions } from "@/lib/importLogic";
import { useImportFlow } from "@/stores/importFlow";
import { MESSY, MESSY_TEXT, useFreshMock } from "@/test/mockTransport";

const BROKEN = "/mock/fixtures/not_a_spreadsheet/broken.csv";

function filePreview(issues: ImportIssue[]): FilePreview {
  return {
    file_id: "f1",
    path: "/mock/fixtures/messy_qualtrics/messy_3header.csv",
    name: "messy_3header.csv",
    sha256: "abc",
    size_bytes: 100,
    format: "csv",
    sheets: [],
    sheet_name: null,
    encoding: "utf-8",
    delimiter: ",",
    qualtrics: { detected: true, confirmed: true, header_rows: 3 },
    n_rows: 10,
    proposed_variables: [],
    sample_rows: [],
    suggested_row_filters: [],
    suggested_scales: [],
    multiselect_candidates: [],
    issues,
  };
}

function loadWithIssues(issues: ImportIssue[]) {
  useFreshMock();
  const preview: DatasetImportPreviewResult = { preview_id: "pv1", files: [filePreview(issues)], stack_proposal: null };
  useImportFlow.setState({ preview, decisions: defaultDecisions(preview) });
}

function missingCode(column: string): ImportIssue {
  return {
    code: "missing_code_suggested",
    severity: "info",
    message: `'${column}' contains -99, which usually means 'no answer'. We marked it as a missing-value code.`,
    file_id: "f1",
    column,
  };
}

async function load(path: string) {
  useFreshMock();
  useImportFlow.getState().addFiles([path]);
  await useImportFlow.getState().runPreview();
}

describe("StepDetect (check how we read them)", () => {
  it("warns when a stray unclosed quote merged rows together", async () => {
    await load(BROKEN);
    render(<StepDetect />);
    const warning = screen.getByText(/quote mark.*was never closed/i);
    expect(warning).toBeInTheDocument();
    // rendered as a Notice, not a bare list item
    expect(warning.closest('[class*="border"]')).toBeInTheDocument();
  });

  it("does not warn on a normal Qualtrics export", async () => {
    await load(MESSY);
    render(<StepDetect />);
    expect(screen.queryByText(/quote mark.*was never closed/i)).not.toBeInTheDocument();
  });
});

describe("StepDetect groups repeated per-column notes", () => {
  it("collapses seven identical -99 notes into one grouped line", () => {
    loadWithIssues(["Q5_1", "Q5_2", "Q5_3", "Q5_4", "Q5_5", "Q5_6", "Q6"].map(missingCode));
    render(<StepDetect />);
    expect(
      screen.getByText("Q5_1 to Q5_6 and Q6 contain -99, which usually means 'no answer'. We marked it as a missing-value code."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^'Q5_1' contains -99/)).not.toBeInTheDocument();
  });

  it("leaves a single note as-is, ungrouped", () => {
    loadWithIssues([missingCode("Q7")]);
    render(<StepDetect />);
    expect(screen.getByText("'Q7' contains -99, which usually means 'no answer'. We marked it as a missing-value code.")).toBeInTheDocument();
  });
});

describe("StepDetect with a numbers + words pair", () => {
  it("explains the pair and shows the words file as labels only", async () => {
    useFreshMock();
    useImportFlow.getState().reset();
    useImportFlow.getState().addFiles([MESSY, MESSY_TEXT]);
    await useImportFlow.getState().runPreview();
    render(<StepDetect />);
    expect(screen.getByText(/same responses exported twice, once with numbers and once with words/)).toBeInTheDocument();
    expect(screen.getByTestId("labels-file")).toHaveTextContent("messy_text_choices.csv");
    expect(screen.getByText("Answer labels only")).toBeInTheDocument();
  });
});
