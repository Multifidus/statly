import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/dialog";
import { useImportFlow } from "@/stores/importFlow";
import { useProjectStore } from "@/stores/project";

/** Asks how to proceed before an import that would otherwise replace an already-loaded dataset
 * (ProjectMenu's "Import data…"). Offers to open a new, untitled project for the import instead
 * of replacing the current project's data, which stays as it is either way. */
export function ImportReplaceDialog() {
  const guard = useImportFlow((s) => s.guard);
  const answer = useImportFlow((s) => s.answerGuard);
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);

  return (
    <AlertDialog open={!!guard} onOpenChange={(open) => !open && answer("cancel")}>
      <AlertDialogContent>
        <AlertDialogTitle>Import into a new project?</AlertDialogTitle>
        <AlertDialogDescription>
          Your project '{project?.name ?? "Untitled project"}' stays as it is. Statly will open a new,
          untitled project for the data you import.{" "}
          {dirty && "You have unsaved changes; Statly will ask before closing this project."}
        </AlertDialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => answer("cancel")} data-testid="import-replace-cancel">
            Cancel
          </Button>
          {guard?.hasData && (
            <Button variant="secondary" onClick={() => answer("replace")} data-testid="import-replace-replace">
              Replace data in this project
            </Button>
          )}
          <Button onClick={() => answer("new")} autoFocus data-testid="import-replace-new">
            New project
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
