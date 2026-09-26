import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/dialog";
import { useImportFlow } from "@/stores/importFlow";

/** Asks before starting a new import that would replace the current project's data
 * (ProjectMenu's "Import data…" when a dataset is already loaded). */
export function ImportReplaceDialog() {
  const guard = useImportFlow((s) => s.guard);
  const answer = useImportFlow((s) => s.answerGuard);
  return (
    <AlertDialog open={!!guard} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialogContent>
        <AlertDialogTitle>Replace this project's data?</AlertDialogTitle>
        <AlertDialogDescription>
          Importing replaces the data in this project. Save first if you want to keep it.
        </AlertDialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => answer(false)} data-testid="import-replace-cancel">
            Cancel
          </Button>
          <Button onClick={() => answer(true)} autoFocus data-testid="import-replace-confirm">
            Continue
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
