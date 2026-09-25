import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/form";
import type { DatasetMeta } from "@/contracts";
import { useDatasetStore } from "@/stores/dataset";

/** Per-variable missing-data summary (SPEC 5.5): blank cells vs declared missing codes. */
export function MissingSummary({ meta }: { meta: DatasetMeta }) {
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useDatasetStore((s) => s.refreshMissing);
  const showMetadata = useDatasetStore((s) => s.showMetadata);
  const hidden = new Set(showMetadata ? [] : meta.variables.filter((v) => v.is_metadata).map((v) => v.name));
  const rows = meta.missing_summary
    .filter((m) => !hidden.has(m.variable))
    .filter((m) => showAll || m.n_missing_blank + m.n_missing_coded > 0)
    .sort((a, b) => b.pct_missing - a.pct_missing);
  const complete = meta.missing_summary.filter((m) => !hidden.has(m.variable) && m.n_missing_blank + m.n_missing_coded === 0).length;

  return (
    <section aria-labelledby="missing-title" className="flex min-h-0 flex-col gap-3" data-testid="missing-summary">
      <div className="flex items-center gap-2">
        <h2 id="missing-title" className="font-semibold">
          Missing answers
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Refresh missing-data summary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw aria-hidden />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Each analysis uses every answer that's there. Someone who answered 8 of 10 questions still counts for those 8.
        Paired tests use only people with answers at every time point, and Statly will tell you how many that is.
      </p>
      <p className="text-sm">
        {complete} variable{complete === 1 ? "" : "s"} have no missing answers.
      </p>
      <CheckboxField label="Show every variable" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
      <div className="min-h-0 overflow-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Missing answers per variable</caption>
          <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 font-medium">Variable</th>
              <th scope="col" className="py-1 text-right font-medium">Blank</th>
              <th scope="col" className="py-1 text-right font-medium">Coded</th>
              <th scope="col" className="py-1 pl-2 font-medium">Missing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.variable} className="border-t">
                <th scope="row" className="py-1 text-left font-mono text-xs font-normal">{m.variable}</th>
                <td className="py-1 text-right tabular-nums">{m.n_missing_blank}</td>
                <td className="py-1 text-right tabular-nums">{m.n_missing_coded}</td>
                <td className="py-1 pl-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-16 overflow-hidden rounded bg-muted" aria-hidden>
                      <div className="h-full bg-foreground/60" style={{ width: `${Math.min(100, m.pct_missing)}%` }} />
                    </div>
                    <span className="tabular-nums">{m.pct_missing.toFixed(1)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-2 text-sm text-muted-foreground">No missing answers.</p>}
      </div>
    </section>
  );
}
