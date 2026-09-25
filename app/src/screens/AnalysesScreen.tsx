import { ChevronRight, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichText } from "@/components/results/RichText";
import { fmtPExpr } from "@/lib/apa";
import { useNav } from "@/stores/nav";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";

const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** The project's Test Log (SPEC §9): every analysis run, newest first; reopen any result. */
export function AnalysesScreen() {
  const log = useProjectStore((s) => s.project?.test_log ?? []);
  const go = useNav((s) => s.go);
  const open = (id: string) => {
    useResults.getState().show(id);
    go("results");
  };
  const entries = [...log].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4" data-testid="analyses-screen">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Analyses</h1>
          <p className="text-muted-foreground">Every test you run is kept here, with its inputs and results, and saved with the project.</p>
        </div>
        <Button onClick={() => go("advisor")} data-testid="new-analysis">
          <Wand2 aria-hidden /> New analysis
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">No analyses yet. The Test Advisor will help you choose one.</p>
      ) : (
        <ul className="grid gap-2" aria-label="Test Log" data-testid="test-log">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => open(e.id)}
                data-testid={`log-entry-${e.id}`}
                className="flex w-full items-start gap-3 rounded-md border p-3 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-medium">
                    {e.result_summary.analysis_label}
                    <span className="font-normal text-muted-foreground"> · {e.result_summary.outcome_variables.join(", ")}</span>
                  </span>
                  <span className="truncate font-serif text-sm">
                    <RichText runs={e.result_summary.apa_sentence} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {fmt(e.timestamp)} · n = {e.result_summary.n_used}
                    {e.result_summary.p !== null && <> · <i>p</i> {fmtPExpr(e.result_summary.p)}</>}
                  </span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
