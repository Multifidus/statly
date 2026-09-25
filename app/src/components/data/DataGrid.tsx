import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ShieldAlert } from "lucide-react";
import { cn } from "cn";
import type { CellValue, DatasetMeta, VariableSchema } from "@/contracts";
import { RowPageCache } from "@/lib/rowPages";

const ROW_H = 32;
const HEADER_H = 52;
const ROWNUM_W = 64;
const COL_W = 150;

export function formatCell(v: CellValue | undefined): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 10_000) / 10_000);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return v.replace(/\s+/g, " ");
}

interface Props {
  meta: DatasetMeta;
  variables: VariableSchema[];
}

/** Virtualized (rows and columns) data grid that pages rows from the engine. */
export function DataGrid({ meta, variables }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const columns = useMemo(() => variables.map((v) => v.name), [variables]);
  const colKey = columns.join("\u0001");

  const cache = useMemo(
    () => new RowPageCache(meta.dataset_id, meta.snapshot_id, columns, bump),
    [meta.dataset_id, meta.snapshot_id, colKey],
  );
  // Re-arm on mount: StrictMode runs mount -> cleanup -> mount on the same memoized cache.
  useEffect(() => {
    cache.disposed = false;
    return () => {
      cache.disposed = true;
    };
  }, [cache]);

  const rows = useVirtualizer({
    count: meta.n_rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });
  const cols = useVirtualizer({
    horizontal: true,
    count: variables.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COL_W,
    overscan: 3,
  });

  const vRows = rows.getVirtualItems();
  const vCols = cols.getVirtualItems();
  const firstRow = vRows[0]?.index ?? 0;
  const lastRow = vRows[vRows.length - 1]?.index ?? Math.min(meta.n_rows - 1, 30);
  useEffect(() => {
    cache.ensureRange(firstRow, lastRow, meta.n_rows);
  }, [cache, firstRow, lastRow, meta.n_rows]);

  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  useEffect(() => setActive((a) => ({ r: Math.min(a.r, Math.max(0, meta.n_rows - 1)), c: Math.min(a.c, Math.max(0, variables.length - 1)) })), [meta.n_rows, variables.length]);

  const missingCodes = useMemo(() => variables.map((v) => new Set(v.missing_codes.map(String))), [variables]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_H) - 1);
    let { r, c } = active;
    switch (e.key) {
      case "ArrowDown": r++; break;
      case "ArrowUp": r--; break;
      case "ArrowRight": c++; break;
      case "ArrowLeft": c--; break;
      case "PageDown": r += page; break;
      case "PageUp": r -= page; break;
      case "Home": if (e.ctrlKey || e.metaKey) r = 0; c = 0; break;
      case "End": if (e.ctrlKey || e.metaKey) r = meta.n_rows - 1; c = variables.length - 1; break;
      default: return;
    }
    e.preventDefault();
    r = Math.max(0, Math.min(meta.n_rows - 1, r));
    c = Math.max(0, Math.min(variables.length - 1, c));
    setActive({ r, c });
    rows.scrollToIndex(r, { align: "auto" });
    cols.scrollToIndex(c, { align: "auto" });
  };

  const cellId = (r: number, c: number) => `cell-${meta.dataset_id}-${r}-${c}`;
  const activeRendered = vRows.some((v) => v.index === active.r) && vCols.some((v) => v.index === active.c);

  if (!variables.length) {
    return <p className="p-6 text-sm text-muted-foreground">No columns to show. Turn on survey system columns to see them.</p>;
  }

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={`Data table, ${meta.n_rows.toLocaleString()} rows and ${variables.length} columns`}
      aria-rowcount={meta.n_rows + 1}
      aria-colcount={variables.length + 1}
      aria-activedescendant={activeRendered ? cellId(active.r, active.c) : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="data-grid"
      className="relative h-full min-h-0 overflow-auto rounded-md border text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div style={{ width: cols.getTotalSize() + ROWNUM_W, height: rows.getTotalSize() + HEADER_H, position: "relative" }}>
        <div role="row" aria-rowindex={1} className="sticky top-0 z-20 flex border-b bg-muted" style={{ height: HEADER_H, width: cols.getTotalSize() + ROWNUM_W }}>
          <div role="columnheader" aria-colindex={1} className="sticky left-0 z-30 border-r bg-muted px-2 py-1 text-xs text-muted-foreground" style={{ width: ROWNUM_W }}>
            Row
          </div>
          {vCols.map((vc) => {
            const v = variables[vc.index];
            return (
              <div
                key={v.name}
                role="columnheader"
                aria-colindex={vc.index + 2}
                title={v.question_text ?? v.label ?? v.name}
                className="absolute top-0 grid content-center gap-0.5 border-r px-2"
                style={{ left: ROWNUM_W + vc.start, width: vc.size, height: HEADER_H }}
              >
                <span className="flex items-center gap-1 truncate font-mono text-xs font-semibold">
                  {v.name}
                  {v.is_pii && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      <ShieldAlert className="size-3" aria-hidden /> PII
                    </span>
                  )}
                </span>
                <span className="truncate text-xs text-muted-foreground">{v.label ?? v.question_text ?? v.dtype}</span>
              </div>
            );
          })}
        </div>
        {vRows.map((vr) => {
          const data = cache.row(vr.index);
          return (
            <div
              key={vr.key}
              role="row"
              aria-rowindex={vr.index + 2}
              className="absolute left-0 flex border-b even:bg-muted/30"
              style={{ top: HEADER_H + vr.start, height: vr.size, width: cols.getTotalSize() + ROWNUM_W }}
            >
              <div role="rowheader" aria-colindex={1} className="sticky left-0 z-10 border-r bg-background px-2 py-1.5 text-right text-xs text-muted-foreground tabular-nums" style={{ width: ROWNUM_W }}>
                {vr.index + 1}
              </div>
              {vCols.map((vc) => {
                const raw = data?.[vc.index];
                const isCode = raw !== null && raw !== undefined && missingCodes[vc.index].has(String(raw));
                const isActive = active.r === vr.index && active.c === vc.index;
                return (
                  <div
                    key={vc.key}
                    id={cellId(vr.index, vc.index)}
                    role="gridcell"
                    aria-colindex={vc.index + 2}
                    aria-selected={isActive}
                    onMouseDown={() => setActive({ r: vr.index, c: vc.index })}
                    title={isCode ? "Missing-value code" : undefined}
                    className={cn(
                      "absolute top-0 truncate border-r px-2 py-1.5",
                      typeof raw === "number" && "text-right tabular-nums",
                      isCode && "text-muted-foreground italic",
                      data === undefined && "text-muted-foreground",
                      isActive && "outline-2 -outline-offset-2 outline-ring",
                    )}
                    style={{ left: ROWNUM_W + vc.start, width: vc.size, height: vr.size }}
                  >
                    {data === undefined ? "…" : formatCell(raw)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
