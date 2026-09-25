import { describe, expect, it, vi } from "vitest";
import type { DatasetRowsParams, DatasetRowsResult } from "@/contracts";
import { PAGE_SIZE, RowPageCache } from "@/lib/rowPages";

function fakeApi(total: number) {
  const rows = vi.fn(async (p: DatasetRowsParams): Promise<DatasetRowsResult> => {
    const n = Math.max(0, Math.min(p.limit, total - p.offset));
    return {
      snapshot_id: "s1",
      offset: p.offset,
      total_rows: total,
      columns: p.columns ?? [],
      row_ids: Array.from({ length: n }, (_, i) => p.offset + i),
      rows: Array.from({ length: n }, (_, i) => [p.offset + i]),
    };
  });
  return { rows };
}

describe("RowPageCache", () => {
  it("fetches the visible pages plus one page ahead, 200 rows each", async () => {
    const api = fakeApi(5000);
    const onLoad = vi.fn();
    const c = new RowPageCache("d", "s1", ["A"], onLoad, api);
    c.ensureRange(0, 30, 5000);
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalledTimes(2));
    expect(api.rows.mock.calls.map(([p]) => [p.offset, p.limit])).toEqual([
      [0, PAGE_SIZE],
      [PAGE_SIZE, PAGE_SIZE],
    ]);
    expect(api.rows.mock.calls[0][0]).toMatchObject({ dataset_id: "d", snapshot_id: "s1", columns: ["A"] });
    expect(c.row(250)).toEqual([250]);
    expect(c.rowId(199)).toBe(199);
    expect(c.row(450)).toBeUndefined();
  });

  it("does not refetch cached or in-flight pages and stops at the last page", async () => {
    const api = fakeApi(300);
    const c = new RowPageCache("d", null, ["A"], () => {}, api);
    c.ensureRange(0, 10, 300);
    c.ensureRange(0, 10, 300);
    await vi.waitFor(() => expect(c.has(1)).toBe(true));
    c.ensureRange(250, 299, 300);
    expect(api.rows).toHaveBeenCalledTimes(2);
  });

  it("ignores results after dispose and survives errors", async () => {
    const api = { rows: vi.fn(async () => Promise.reject({ kind: "rpc", code: -32002, message: "stale" })) };
    const c = new RowPageCache("d", "old", ["A"], () => {}, api);
    await c.ensure(0);
    expect(c.has(0)).toBe(false);
    c.disposed = true;
    await c.ensure(1);
    expect(api.rows).toHaveBeenCalledTimes(1);
  });
});
