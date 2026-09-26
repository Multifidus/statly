import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepDetect } from "@/components/import/StepDetect";
import { useImportFlow } from "@/stores/importFlow";
import { MESSY, MESSY_TEXT, useFreshMock } from "@/test/mockTransport";

const BROKEN = "/mock/fixtures/not_a_spreadsheet/broken.csv";

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
