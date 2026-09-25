/**
 * Page cache for the virtualized grid. The frontend never holds the whole dataset: it asks
 * the engine for 200-row pages via `dataset.rows`, keeps the pages it has seen for the
 * current (dataset, snapshot, columns) key, and prefetches the page after the visible range.
 */
import type { CellValue, DatasetRowsResult } from "@/contracts";
import { rpc, type Rpc } from "@/lib/rpc";

export const PAGE_SIZE = 200;
/** Keep at most this many pages (LRU) so memory stays flat on very long datasets. */
export const MAX_PAGES = 40;

export class RowPageCache {
  private pages = new Map<number, DatasetRowsResult>();
  private inflight = new Set<number>();
  disposed = false;

  constructor(
    readonly datasetId: string,
    readonly snapshotId: string | null,
    readonly columns: string[],
    private readonly onLoad: () => void,
    private readonly api: Pick<Rpc, "rows"> = rpc,
  ) {}

  pageOf(row: number) {
    return Math.floor(row / PAGE_SIZE);
  }

  has(page: number) {
    return this.pages.has(page);
  }

  /** Fetch the pages covering [firstRow, lastRow] plus the next page (prefetch). */
  ensureRange(firstRow: number, lastRow: number, totalRows: number) {
    if (totalRows <= 0) return;
    const lastPage = this.pageOf(Math.max(0, totalRows - 1));
    const from = this.pageOf(Math.max(0, firstRow));
    const to = Math.min(lastPage, this.pageOf(Math.max(0, lastRow)) + 1);
    for (let p = from; p <= to; p++) void this.ensure(p);
  }

  async ensure(page: number): Promise<void> {
    if (this.disposed || this.pages.has(page) || this.inflight.has(page)) return;
    this.inflight.add(page);
    try {
      const res = await this.api.rows({
        dataset_id: this.datasetId,
        snapshot_id: this.snapshotId,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        columns: this.columns,
        sort: null,
      });
      if (this.disposed) return;
      this.pages.set(page, res);
      if (this.pages.size > MAX_PAGES) {
        const oldest = this.pages.keys().next().value;
        if (oldest !== undefined) this.pages.delete(oldest);
      }
      this.onLoad();
    } catch {
      // Stale snapshot or engine hiccup: leave the page empty; it is retried on next scroll.
    } finally {
      this.inflight.delete(page);
    }
  }

  row(r: number): CellValue[] | undefined {
    const p = this.pages.get(this.pageOf(r));
    if (!p) return undefined;
    // Touch for LRU.
    this.pages.delete(this.pageOf(r));
    this.pages.set(this.pageOf(r), p);
    return p.rows[r - p.offset];
  }

  rowId(r: number): number | undefined {
    const p = this.pages.get(this.pageOf(r));
    return p?.row_ids[r - p.offset];
  }
}
