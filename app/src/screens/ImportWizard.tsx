import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/form";
import { StepCleanup } from "@/components/import/StepCleanup";
import { StepDetect } from "@/components/import/StepDetect";
import { StepFiles } from "@/components/import/StepFiles";
import { StepLinking } from "@/components/import/StepLinking";
import { StepStacking } from "@/components/import/StepStacking";
import { StepSummary } from "@/components/import/StepSummary";
import { blockingReason } from "@/lib/importLogic";
import { STEP_TITLES, stepsFor, useImportFlow, type StepId } from "@/stores/importFlow";
import { useDatasetStore } from "@/stores/dataset";
import { useInterview } from "@/stores/interview";
import { useNav } from "@/stores/nav";

const BODY: Record<StepId, () => React.ReactNode> = {
  files: () => <StepFiles />,
  detect: () => <StepDetect />,
  cleanup: () => <StepCleanup />,
  stack: () => <StepStacking />,
  link: () => <StepLinking />,
  summary: () => <StepSummary />,
};

export function ImportWizard() {
  const s = useImportFlow();
  const go = useNav((n) => n.go);
  const hasData = useDatasetStore((d) => !!d.meta);
  const steps = stepsFor(s.files.length);
  const index = Math.max(0, steps.indexOf(s.step));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // Move focus to the step heading on every step change (screen readers announce it).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [s.step]);

  const blocked = s.busy ? null : blockingReason(s.step, s.preview, s.decisions, s.files.length);
  const done = !!s.result;

  const next = async () => {
    if (s.step === "files") {
      if (await s.runPreview()) s.goTo("detect");
      return;
    }
    if (s.step === "summary") {
      // After an import the Variable Interview starts (SPEC §6); it can be skipped.
      if (done) {
        useInterview.getState().reset();
        go("interview");
        s.reset();
        return;
      }
      const ok = await s.commit();
      if (ok && !useImportFlow.getState().result?.linkReport) {
        useInterview.getState().reset();
        go("interview");
        s.reset();
      }
      return;
    }
    s.goTo(steps[index + 1]);
  };

  const cancel = () => {
    s.reset();
    go(hasData ? "data" : "home");
  };

  const nextLabel =
    s.step === "summary" ? (done ? "Set up variables" : "Import") : s.step === "files" ? "Read files" : "Continue";

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 md:grid-cols-[13rem_1fr]">
      <nav aria-label="Import steps">
        <ol className="grid gap-1">
          {steps.map((id, i) => {
            const state = i < index ? "done" : i === index ? "current" : "todo";
            return (
              <li key={id}>
                <button
                  type="button"
                  disabled={state === "todo" || s.busy || done}
                  onClick={() => s.goTo(id)}
                  aria-current={state === "current" ? "step" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    state === "current" && "bg-accent font-semibold",
                    state === "todo" && "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                      state === "done" && "border-primary bg-primary text-primary-foreground",
                      state === "current" && "border-primary",
                    )}
                    aria-hidden
                  >
                    {state === "done" ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  {STEP_TITLES[id]}
                  {state === "done" && <span className="sr-only"> (done)</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-labelledby="step-title" className="grid content-start gap-5">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Step {index + 1} of {steps.length}
          </p>
          <h2 id="step-title" ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
            {done ? "Import complete" : STEP_TITLES[s.step]}
          </h2>
        </div>

        {BODY[s.step]()}

        {s.error && (
          <Notice tone="error" role="alert">
            {s.error}
          </Notice>
        )}

        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background py-3">
          {!done && (
            <Button variant="ghost" onClick={cancel} disabled={s.busy}>
              Cancel
            </Button>
          )}
          <div className="ml-auto flex items-center gap-3">
            {blocked && (
              <p className="text-sm text-muted-foreground" id="blocked-reason" role="status">
                {blocked}
              </p>
            )}
            {index > 0 && !done && (
              <Button variant="outline" onClick={() => s.goTo(steps[index - 1])} disabled={s.busy}>
                <ArrowLeft aria-hidden /> Back
              </Button>
            )}
            <Button
              onClick={() => void next()}
              disabled={!!blocked || s.busy}
              aria-describedby={blocked ? "blocked-reason" : undefined}
              data-testid="wizard-next"
            >
              {s.busy && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
              {nextLabel}
              {!s.busy && s.step !== "summary" && <ArrowRight aria-hidden />}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
