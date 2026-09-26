import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepDetect } from "@/components/import/StepDetect";
import { useImportFlow } from "@/stores/importFlow";
import { MESSY, useFreshMock } from "@/test/mockTransport";

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
