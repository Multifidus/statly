import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { DatasetMeta, VariableSchema } from "@/contracts";
import { useFreshMock } from "@/test/mockTransport";
import { DataGrid } from "@/components/data/DataGrid";
import { useDatasetStore } from "@/stores/dataset";

function makeVariable(overrides: Partial<VariableSchema>): VariableSchema {
  return {
    schema_version: 1,
    name: "v",
    label: null,
    question_text: null,
    role: "unassigned",
    level: "continuous",
    dtype: "float",
    value_labels: [],
    reverse_coded: false,
    response_range: null,
    scale_id: null,
    missing_codes: [],
    sources: [],
    is_metadata: false,
    is_pii: false,
    pii_reason: null,
    computed: null,
    display_order: 0,
    ...overrides,
  };
}

function makeMeta(variables: VariableSchema[]): DatasetMeta {
  return {
    schema_version: 1,
    dataset_id: "d1",
    snapshot_id: "s1",
    n_rows: 10,
    row_id_column: "_statly_row_id",
    variables,
    scales: [],
    import_log: { files: [], row_filters: [], dropped_columns: [] },
    stacking: null,
    link: { mode: "aggregate", id_variable: null, normalization: null, counts: null },
    missing_summary: [],
  };
}

const VARS = ["A", "B", "C", "D"].map((name, i) => makeVariable({ name, display_order: i }));
const META = makeMeta(VARS);

beforeEach(() => {
  useFreshMock();
  // jsdom elements report 0x0; the virtualizer's initial size comes from offsetWidth/Height, so
  // without this no rows or columns would be considered "in view" and nothing would render.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DataGrid: recent-columns scroll and highlight", () => {
  it("scrolls to and highlights a column named in recentColumns on mount", () => {
    vi.useFakeTimers();
    const scrollToSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: scrollToSpy, writable: true, configurable: true });

    useDatasetStore.getState().setRecentColumns(["B"]);
    render(<DataGrid meta={META} variables={VARS} />);

    expect(scrollToSpy).toHaveBeenCalled();
    const header = screen.getByTestId("col-header-B");
    expect(header).toHaveAttribute("data-recent", "true");

    // recentColumns is consumed so re-renders don't re-trigger the scroll/highlight.
    expect(useDatasetStore.getState().recentColumns).toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(header).not.toHaveAttribute("data-recent");
  });

  it("does not highlight anything when recentColumns is empty", () => {
    render(<DataGrid meta={META} variables={VARS} />);
    const header = screen.getByTestId("col-header-A");
    expect(header).not.toHaveAttribute("data-recent");
  });

  it("scrolls to and highlights the jumpTarget column", () => {
    vi.useFakeTimers();
    const scrollToSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: scrollToSpy, writable: true, configurable: true });

    render(<DataGrid meta={META} variables={VARS} jumpTarget={{ name: "C", ts: Date.now() }} />);

    expect(scrollToSpy).toHaveBeenCalled();
    const header = screen.getByTestId("col-header-C");
    expect(header).toHaveAttribute("data-recent", "true");
  });
});
