import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/dialog";
import { useProjectStore } from "@/stores/project";

/** Save / Don't save / Cancel prompt driven by useProjectStore.confirmUnsaved(). */
export function UnsavedChangesDialog() {
  const guard = useProjectStore((s) => s.guard);
  const answer = useProjectStore((s) => s.answerGuard);
  const name = useProjectStore((s) => s.project?.name ?? "this project");
  return (
    <AlertDialog open={!!guard} onOpenChange={(open) => !open && answer("cancel")}>
      <AlertDialogContent>
        <AlertDialogTitle>Save changes to {name}?</AlertDialogTitle>
        <AlertDialogDescription>
          {guard?.reason ? `${guard.reason}: ` : ""}if you don't save, your changes since the last save will be lost.
        </AlertDialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => answer("cancel")}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => answer("discard")}>
            Don't save
          </Button>
          <Button onClick={() => answer("save")} autoFocus>
            Save
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
