import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/dialog";
import { usePlanner } from "@/stores/planner";

/** Asks before replacing an unsaved in-progress plan with the project's saved one (usePlanner.openProjectPlan). */
export function ReplacePlanDialog() {
  const guard = usePlanner((s) => s.guard);
  const answer = usePlanner((s) => s.answerGuard);
  return (
    <AlertDialog open={!!guard} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialogContent>
        <AlertDialogTitle>Replace your in-progress plan?</AlertDialogTitle>
        <AlertDialogDescription>
          This project has a saved study plan, but you have unsaved changes to a different plan on screen. Opening the saved plan will discard your unsaved changes.
        </AlertDialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => answer(false)} data-testid="replace-plan-cancel">
            Keep my plan
          </Button>
          <Button onClick={() => answer(true)} autoFocus data-testid="replace-plan-confirm">
            Show the saved plan
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
