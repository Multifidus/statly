import { useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TOUR_STEPS } from "./steps";
import { useOnboarding } from "./store";

/** First-run onboarding tour: a stepped dialog over the main workflow. Re-launchable from the UI. */
export function Tour() {
  const open = useOnboarding((s) => s.open);
  const step = useOnboarding((s) => s.step);
  const next = useOnboarding((s) => s.next);
  const back = useOnboarding((s) => s.back);
  const dismiss = useOnboarding((s) => s.dismiss);

  const total = TOUR_STEPS.length;
  const current = TOUR_STEPS[step] ?? TOUR_STEPS[0];
  const isLast = step === total - 1;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next(total);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
      // Escape is handled by Radix Dialog's onOpenChange below.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, back, total]);

  return (
    <Dialog open={open} onOpenChange={(next_) => !next_ && dismiss()}>
      <DialogContent className="max-w-md" data-testid="onboarding-tour">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{current.target}</span>
        <DialogTitle>{current.title}</DialogTitle>
        <DialogDescription>{current.body}</DialogDescription>
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            Step {step + 1} of {total}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={dismiss} data-testid="tour-skip">
              Skip
            </Button>
            {step > 0 && (
              <Button variant="outline" size="sm" onClick={back} data-testid="tour-back">
                Back
              </Button>
            )}
            <Button size="sm" onClick={() => next(total)} data-testid="tour-next">
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
