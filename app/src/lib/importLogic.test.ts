import { describe, expect, it } from "vitest";
import { formatRowFilterGroup, groupRowFilters } from "@/lib/importLogic";
import type { RowFilter } from "@/contracts";

const filter = (over: Partial<RowFilter>): RowFilter => ({
  id: "id",
  kind: "exclude_values",
  file_id: null,
  variable: "Status",
  values: ["Survey Preview", "Survey Test", "Spam"],
  threshold: null,
  explanation: "Removes test runs and spam.",
  rows_removed: 0,
  ...over,
});

describe("groupRowFilters + formatRowFilterGroup", () => {
  it("collapses the same filter kind/values across files into one group with a per-file breakdown", () => {
    const filters: RowFilter[] = [
      filter({ id: "pre_status", file_id: "pre", rows_removed: 0 }),
      filter({ id: "post_status", file_id: "post", rows_removed: 0 }),
    ];
    const [group] = groupRowFilters(filters);
    expect(group.rowsRemoved).toBe(0);
    expect(group.perFile).toHaveLength(2);
    const fileName = (id: string | null) => (id === "pre" ? "pre.csv" : id === "post" ? "post.csv" : "file");
    expect(formatRowFilterGroup(group, fileName)).toBe("Survey Preview, Survey Test and Spam responses (pre.csv: 0, post.csv: 0)");
  });

  it("omits the per-file breakdown for a single file", () => {
    const [group] = groupRowFilters([filter({ file_id: "pre", rows_removed: 3 })]);
    expect(formatRowFilterGroup(group, () => "pre.csv")).toBe("Survey Preview, Survey Test and Spam responses");
  });

  it("keeps distinct filter kinds as separate groups", () => {
    const filters: RowFilter[] = [
      filter({ id: "a", file_id: "pre" }),
      filter({ id: "b", file_id: "pre", kind: "exclude_unfinished", variable: "Finished", values: null }),
      filter({ id: "c", file_id: "pre", kind: "progress_below", variable: "Progress", values: null, threshold: 100 }),
    ];
    const groups = groupRowFilters(filters);
    expect(groups.map((g) => g.label)).toEqual(["Survey Preview, Survey Test and Spam responses", "unfinished responses", "progress below 100%"]);
  });
});
