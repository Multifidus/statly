import { cn } from "cn";
import type { ApaTable } from "@/contracts";
import { CopyButton } from "@/components/results/CopyButton";
import { RichText } from "@/components/results/RichText";
import { alignOf, cellToPlain, tablePayload } from "@/lib/apa";

/** APA 7 table (SPEC §10.1): bold number, italic title, horizontal rules only, notes. */
export function ApaTableView({ table, fallbackNumber = 1, testId }: { table: ApaTable; fallbackNumber?: number; testId?: string }) {
  const titleId = `apa-title-${testId ?? fallbackNumber}`;
  const groups = [...table.column_groups].sort((a, b) => a.first_column - b.first_column);
  const groupCells: { label: ApaTable["column_groups"][number]["label"] | null; span: number }[] = [];
  let col = 0;
  for (const g of groups) {
    if (g.first_column > col) groupCells.push({ label: null, span: g.first_column - col });
    groupCells.push({ label: g.label, span: g.span });
    col = g.first_column + g.span;
  }
  if (groups.length && col < table.columns.length) groupCells.push({ label: null, span: table.columns.length - col });
  const alignCls = { left: "text-left", center: "text-center", right: "text-right" } as const;

  return (
    <div className="grid gap-2" data-testid={testId}>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="font-semibold">Table {table.number ?? fallbackNumber}</p>
          <p id={titleId} className="italic">
            {table.title}
          </p>
        </div>
        <CopyButton payload={() => tablePayload(table, fallbackNumber)} label="Copy table" testId={testId ? `${testId}-copy` : undefined} />
      </div>
      <div className="overflow-x-auto">
        <table aria-labelledby={titleId} className="w-full border-t border-b border-foreground/80 font-serif text-sm tabular-nums">
          <thead>
            {groupCells.length > 0 && (
              <tr>
                {groupCells.map((g, i) => (
                  <th key={i} colSpan={g.span} scope="colgroup" className={cn("px-2 pt-1 text-center font-normal", g.label && "border-b border-foreground/60")}>
                    {g.label && <RichText runs={g.label} />}
                  </th>
                ))}
              </tr>
            )}
            <tr className="border-b border-foreground/80">
              {table.columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-2 py-1 font-normal", alignCls[alignOf(c)])}>
                  <RichText runs={c.header} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri} className={cn(row.kind === "total" && "border-t border-foreground/40")}>
                {row.cells.map((cell, ci) => {
                  const c = table.columns[ci];
                  return (
                    <td
                      key={ci}
                      className={cn("px-2 py-0.5", c ? alignCls[alignOf(c)] : "text-left", row.kind === "section_header" && "italic")}
                      style={ci === 0 && row.indent ? { paddingLeft: `${0.5 + row.indent}rem` } : undefined}
                    >
                      {cell.type === "text" ? <RichText runs={cell.text} /> : cellToPlain(cell)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(table.notes.general || table.notes.specific.length > 0 || table.notes.probability.length > 0) && (
        <div className="font-serif text-xs">
          {table.notes.general && (
            <p>
              <i>Note.</i> <RichText runs={table.notes.general} />
            </p>
          )}
          {table.notes.specific.map((n, i) => (
            <p key={`s${i}`}>
              <RichText runs={n} />
            </p>
          ))}
          {table.notes.probability.map((n, i) => (
            <p key={`p${i}`}>
              <RichText runs={n} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
