import { useEffect, useRef, useState } from "react";
import { ListChecks, Loader2, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/form";
import { CopyButton } from "@/components/results/CopyButton";
import { RichText } from "@/components/results/RichText";
import { ResultsView } from "@/components/results/ResultsView";
import { FamilyBadge } from "@/components/testlog/FamilyBadge";
import { sentencePayload } from "@/lib/apa";
import { useAdvisor } from "@/stores/advisor";
import { useAnalysisFlow } from "@/stores/analysisFlow";
import { useNav } from "@/stores/nav";
import { useNotify } from "@/stores/notify";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";
import { useTestLog } from "@/stores/testLog";

/** Results for one Test Log entry (the latest run, or one reopened from the Analyses list). */
export function ResultsScreen() {
  const id = useResults((s) => s.currentId);
  const result = useResults((s) => (id ? s.byId[id] : undefined));
  const loading = useResults((s) => s.loading);
  const error = useResults((s) => s.error);
  const entry = useProjectStore((s) => s.project?.test_log.find((e) => e.id === id) ?? null);
  const go = useNav((s) => s.go);
  const focused = useRef<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const runFisher = async () => {
    if (!result) return;
    const entryId = await useAnalysisFlow.getState().runAlternative(result, "fisher_exact");
    if (!entryId) {
      const err = useAnalysisFlow.getState().error;
      useNotify.getState().show(err ?? "Statly couldn't run Fisher's exact test.", "error");
    }
  };

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
        <ListChecks aria-hidden /> Test Log
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void useAdvisor.getState().startAnother();
          go("advisor");
        }}
      >
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
      <div className="flex flex-wrap items-start justify-between gap-2">
        {actions}
        <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)} data-testid="delete-result">
          <Trash2 aria-hidden /> Delete
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid="delete-test-dialog">
          <AlertDialogTitle>Delete this test?</AlertDialogTitle>
          <AlertDialogDescription>
            Its results are removed from the log and from any report you export. This can&apos;t be undone.
          </AlertDialogDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="ghost" data-testid="delete-test-cancel">
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={() => {
                  useTestLog.getState().deleteTest(entry.id);
                  setConfirmDelete(false);
                }}
                data-testid="delete-test-confirm"
              >
                Delete
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {result ? (
        <ResultsView result={result} title={entry.result_summary.analysis_label} badge={entry.family_id ? <FamilyBadge entry={entry} /> : undefined} onRunFisher={() => void runFisher()} />
      ) : loading ? (
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Loading the full results…
        </p>
      ) : (
        <div className="grid gap-4">
          <h1 id="results-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
            {entry.result_summary.analysis_label}
          </h1>
          {entry.family_id && <FamilyBadge entry={entry} />}
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
