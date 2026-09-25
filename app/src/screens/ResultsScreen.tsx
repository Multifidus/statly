import { useEffect, useRef } from "react";
import { ListChecks, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/form";
import { CopyButton } from "@/components/results/CopyButton";
import { RichText } from "@/components/results/RichText";
import { ResultsView } from "@/components/results/ResultsView";
import { sentencePayload } from "@/lib/apa";
import { useNav } from "@/stores/nav";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";

/** Results for one Test Log entry (the latest run, or one reopened from the Analyses list). */
export function ResultsScreen() {
  const id = useResults((s) => s.currentId);
  const result = useResults((s) => (id ? s.byId[id] : undefined));
  const loading = useResults((s) => s.loading);
  const error = useResults((s) => s.error);
  const entry = useProjectStore((s) => s.project?.test_log.find((e) => e.id === id) ?? null);
  const go = useNav((s) => s.go);
  const focused = useRef<string | null>(null);

  useEffect(() => {
    if (id && !result) void useResults.getState().reopen(id);
  }, [id, result]);

  useEffect(() => {
    if (result && focused.current !== id) {
      focused.current = id;
      document.getElementById("results-title")?.focus();
    }
  }, [result, id]);

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => go("analyses")} data-testid="to-analyses">
        <ListChecks aria-hidden /> All analyses
      </Button>
      <Button variant="outline" size="sm" onClick={() => go("advisor")}>
        <Wand2 aria-hidden /> Start another analysis
      </Button>
    </div>
  );

  if (!entry) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <p className="text-muted-foreground">No analysis selected.</p>
        {actions}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4" data-testid="results-screen">
      {actions}
      {result ? (
        <ResultsView result={result} title={entry.result_summary.analysis_label} />
      ) : loading ? (
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Loading the full results…
        </p>
      ) : (
        <div className="grid gap-4">
          <h1 id="results-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
            {entry.result_summary.analysis_label}
          </h1>
          <Notice tone="info">
            {error ?? "Your data has changed since this analysis was run, so Statly is showing the summary it saved. Run the analysis again to see the full tables and checks."}
          </Notice>
          <p className="text-base leading-relaxed">{entry.result_summary.plain_language_summary}</p>
          <p className="font-serif text-base" data-testid="apa-sentence">
            <RichText runs={entry.result_summary.apa_sentence} />
          </p>
          <div>
            <CopyButton payload={() => sentencePayload(entry.result_summary.apa_sentence)} label="Copy sentence" testId="copy-sentence" />
          </div>
        </div>
      )}
    </div>
  );
}
