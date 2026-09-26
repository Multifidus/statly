import type { ChartSpec } from "@/contracts";
import { formatCell, numbersTable } from "@/lib/chartbuilder/numbers";
import type { ChartsDataResult } from "@/lib/chartbuilder/types";

const MAX_ROWS = 400;

/** "Show the numbers": the values behind the chart as a table (screen-reader and keyboard friendly). */
export function NumbersTableView({ spec, data }: { spec: ChartSpec; data: ChartsDataResult }) {
  const t = numbersTable(spec, data);
  const rows = t.rows.slice(0, MAX_ROWS);
  const excluded = data.meta.n_excluded ?? 0;
  return (
    <details className="text-xs" data-testid="chart-numbers">
      <summary className="cursor-pointer rounded-sm text-sm text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">Show the numbers</summary>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="border-collapse">
          <caption className="pb-1 text-left text-muted-foreground">
            {t.caption}
            {data.meta.n_used !== undefined && ` · ${data.meta.n_used} rows used${excluded ? `, ${excluded} left out (missing or filtered)` : ""}`}
          </caption>
          <thead>
            <tr>
              {t.columns.map((c) => (
                <th key={c.key} scope="col" className={"border-b px-2 py-0.5 font-medium " + (c.numeric ? "text-right" : "text-left")}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {t.columns.map((c) => (
                  <td key={c.key} className={"px-2 py-0.5 " + (c.numeric ? "text-right tabular-nums" : "")}>
                    {formatCell(r[c.key], c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {t.rows.length > MAX_ROWS && <p className="mt-1 text-muted-foreground">Showing the first {MAX_ROWS} of {t.rows.length} rows.</p>}
      </div>
    </details>
  );
}
