import { describe, expect, it } from "vitest";
import type { ImportIssue } from "@/contracts";
import { groupImportIssues } from "@/lib/importIssues";

function missingCode(column: string): ImportIssue {
  return {
    code: "missing_code_suggested",
    severity: "info",
    message: `'${column}' contains -99, which usually means 'no answer'. We marked it as a missing-value code.`,
    file_id: "f1",
    column,
  };
}

describe("groupImportIssues", () => {
  it("collapses identical per-column notes, with consecutive numbers run together", () => {
    const issues = ["Q5_1", "Q5_2", "Q5_3", "Q5_4", "Q5_5", "Q5_6", "Q6"].map(missingCode);
    const grouped = groupImportIssues(issues);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].severity).toBe("info");
    expect(grouped[0].columns).toEqual(["Q5_1", "Q5_2", "Q5_3", "Q5_4", "Q5_5", "Q5_6", "Q6"]);
    expect(grouped[0].message).toBe(
      "Q5_1 to Q5_6 and Q6 contain -99, which usually means 'no answer'. We marked it as a missing-value code.",
    );
  });

  it("leaves a single note ungrouped, unchanged", () => {
    const issues = [missingCode("Q7")];
    const grouped = groupImportIssues(issues);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].columns).toEqual(["Q7"]);
    expect(grouped[0].message).toBe("'Q7' contains -99, which usually means 'no answer'. We marked it as a missing-value code.");
  });

  it("does not group issues with an unknown code, even with matching text", () => {
    const issues: ImportIssue[] = [
      { code: "some_other_code", severity: "caution", message: "'A' looks odd.", file_id: "f1", column: "A" },
      { code: "some_other_code", severity: "caution", message: "'B' looks odd.", file_id: "f1", column: "B" },
    ];
    const grouped = groupImportIssues(issues);
    expect(grouped).toHaveLength(2);
  });

  it("does not group across different severities or different rest text", () => {
    const issues = [missingCode("Q1"), { ...missingCode("Q2"), message: "'Q2' contains -98, which usually means 'no answer'. We marked it as a missing-value code." }];
    const grouped = groupImportIssues(issues);
    expect(grouped).toHaveLength(2);
  });
});
