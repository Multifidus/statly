import { describe, expect, it } from "vitest";
import { useDatasetStore } from "@/stores/dataset";

describe("dataset store: recentColumns", () => {
  it("setRecentColumns records the names and a timestamp", () => {
    useDatasetStore.getState().setRecentColumns(["Q1_yes", "Q1_no"]);
    const rc = useDatasetStore.getState().recentColumns;
    expect(rc?.names).toEqual(["Q1_yes", "Q1_no"]);
    expect(rc?.ts).toBeGreaterThan(0);
  });

  it("does nothing when given an empty list", () => {
    useDatasetStore.setState({ recentColumns: null });
    useDatasetStore.getState().setRecentColumns([]);
    expect(useDatasetStore.getState().recentColumns).toBeNull();
  });

  it("clearRecentColumns resets to null", () => {
    useDatasetStore.getState().setRecentColumns(["x"]);
    useDatasetStore.getState().clearRecentColumns();
    expect(useDatasetStore.getState().recentColumns).toBeNull();
  });

  it("clear() also resets recentColumns", () => {
    useDatasetStore.getState().setRecentColumns(["x"]);
    useDatasetStore.getState().clear();
    expect(useDatasetStore.getState().recentColumns).toBeNull();
  });
});
