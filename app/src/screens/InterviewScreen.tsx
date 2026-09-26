import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Upload } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/form";
import {
  StepAnswerKey,
  StepIntro,
  StepLabels,
  StepLevel,
  StepRole,
  StepScales,
  StepScoring,
  StepSummary,
} from "@/components/interview/InterviewSteps";
import { useDatasetStore } from "@/stores/dataset";
import { useImportFlow } from "@/stores/importFlow";
import { useInterview } from "@/stores/interview";
import { useNav } from "@/stores/nav";
import { useNotify } from "@/stores/notify";

type Section = "intro" | "role" | "level" | "labels" | "answer_key" | "scales" | "scoring" | "summary";

const SECTION_TITLES: Record<Section, string> = {
  intro: "Welcome",
  role: "What is each question?",
  level: "Kinds of answers",
  labels: "Answer choices",
  answer_key: "Test scoring",
  scales: "Scales",
  scoring: "Scale scores",
  summary: "Summary",
};

const sectionOf = (step: string): Section => step.split(":")[0] as Section;
const unitOf = (step: string) => step.slice(step.indexOf(":") + 1);

function Body({ step }: { step: string }) {
  const sec = sectionOf(step);
  switch (sec) {
    case "intro":
      return <StepIntro />;
    case "role":
      return <StepRole unitId={unitOf(step)} />;
    case "level":
      return <StepLevel unitId={unitOf(step)} />;
    case "labels":
      return <StepLabels unitId={unitOf(step)} />;
    case "answer_key":
      return <StepAnswerKey />;
    case "scales":
      return <StepScales />;
    case "scoring":
      return <StepScoring />;
    default:
      return <StepSummary />;
  }
}

/** Variable Interview (SPEC §6): one question at a time, then a summary that applies everything. */
export function InterviewScreen() {
  const s = useInterview();
  const meta = useDatasetStore((d) => d.meta);
  const go = useNav((n) => n.go);
  const resetImportFlow = useImportFlow((s) => s.reset);
  const notify = useNotify((n) => n.show);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (meta && (s.status === "idle" || s.datasetId !== meta.dataset_id) && s.status !== "loading" && s.status !== "applying") {
      void s.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.dataset_id]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [s.step]);

  if (!meta) {
    return (
      <div className="mx-auto max-w-md pt-8" data-testid="interview-empty-state">
        <EmptyState
          icon={Upload}
          title="No dataset yet"
          body="Import some data first, then Statly can ask you about your variables."
          action={{ label: "Import a file", icon: Upload, onClick: () => { resetImportFlow(); go("import"); } }}
        />
      </div>
    );
  }
  if (s.status === "loading" || s.status === "idle" || !s.draft) {
    return (
      <div className="mx-auto grid max-w-md gap-3 text-center" role="status">
        {s.error ? <Notice tone="error">{s.error}</Notice> : <p className="text-muted-foreground">Getting your questions ready…</p>}
      </div>
    );
  }

  const steps = s.steps();
  const index = Math.max(0, steps.indexOf(s.step));
  const sec = sectionOf(steps[index]);
  const sections = [...new Set(steps.map(sectionOf))];
  const inSection = steps.filter((x) => sectionOf(x) === sec);
  const posInSection = inSection.indexOf(steps[index]);
  const problem = s.problem();
  const last = index === steps.length - 1;
  const applying = s.status === "applying";

  const skip = () => {
    s.reset();
    go("data");
  };
  const next = async () => {
    if (!last) {
      s.next();
      return;
    }
    if (await useInterview.getState().finish()) {
      const ws = useInterview.getState().warnings;
      notify(ws.length ? `Your variables are set up. Note: ${ws.join(" ")}` : "Your variables are set up.");
      s.reset();
      go("variables");
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 md:grid-cols-[13rem_1fr]">
      <nav aria-label="Interview sections">
        <ol className="grid gap-1">
          {sections.map((id, i) => {
            const firstStep = steps.find((x) => sectionOf(x) === id)!;
            const cur = sections.indexOf(sec);
            const state = i < cur ? "done" : i === cur ? "current" : "todo";
            return (
              <li key={id}>
                <button
                  type="button"
                  disabled={state === "todo" || applying}
                  onClick={() => s.goTo(firstStep)}
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
                  {SECTION_TITLES[id]}
                  {state === "done" && <span className="sr-only"> (done)</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-labelledby="interview-title" className="grid content-start gap-5">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase" data-testid="interview-progress">
            Step {index + 1} of {steps.length}
            {inSection.length > 1 && ` · ${posInSection + 1} of ${inSection.length} in this part`}
          </p>
          <h2 id="interview-title" ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
            {SECTION_TITLES[sec]}
          </h2>
        </div>

        <Body key={steps[index]} step={steps[index]} />

        {s.error && (
          <Notice tone="error" role="alert">
            {s.error}
          </Notice>
        )}

        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background py-3">
          <Button variant="ghost" onClick={skip} disabled={applying}>
            Skip for now
          </Button>
          <div className="ml-auto flex items-center gap-3">
            {problem && (
              <p className="text-sm text-muted-foreground" id="interview-blocked" role="status">
                {problem}
              </p>
            )}
            {index > 0 && (
              <Button variant="outline" onClick={() => s.back()} disabled={applying}>
                <ArrowLeft aria-hidden /> Back
              </Button>
            )}
            <Button onClick={() => void next()} disabled={!!problem || applying} aria-describedby={problem ? "interview-blocked" : undefined} data-testid="interview-next">
              {applying && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
              {last ? "Finish" : index === 0 ? "Start" : "Continue"}
              {!applying && !last && <ArrowRight aria-hidden />}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
