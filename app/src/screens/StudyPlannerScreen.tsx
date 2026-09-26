import { useEffect } from "react";
import { ArrowRight, ClipboardList, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { WhyItMatters } from "@/components/ui/why";
import { InterviewStep } from "@/components/planner/InterviewStep";
import { PlanView } from "@/components/planner/PlanView";
import { PowerStep } from "@/components/planner/PowerStep";
import { useAnalysisFlow } from "@/stores/analysisFlow";
import { type PlannerStep, projectPlan, usePlanner } from "@/stores/planner";

const STEPS: { id: PlannerStep; label: string }[] = [
  { id: "describe", label: "Your study" },
  { id: "interview", label: "Design" },
  { id: "power", label: "Sample size" },
  { id: "plan", label: "Plan" },
];

function Stepper() {
  const p = usePlanner();
  const reachable: Record<PlannerStep, boolean> = {
    describe: true,
    interview: !!p.title.trim(),
    power: !!p.powerPlan,
    plan: !!p.plan || !!p.apriori,
  };
  const current = STEPS.findIndex((s) => s.id === p.step);
  return (
    <nav aria-label="Study Planner steps">
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <Button
              variant={s.id === p.step ? "default" : "ghost"}
              size="sm"
              aria-current={s.id === p.step ? "step" : undefined}
              disabled={!reachable[s.id]}
              onClick={() => (s.id === "interview" ? void p.beginInterview() : p.goTo(s.id))}
              data-testid={`planner-step-${s.id}`}
            >
              <span aria-hidden className={i < current ? "text-muted-foreground" : undefined}>
                {i + 1}.
              </span>{" "}
              {s.label}
            </Button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function DescribeStep() {
  const p = usePlanner();
  return (
    <form
      className="grid gap-4 rounded-xl border p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (p.title.trim()) void p.beginInterview();
      }}
    >
      <div className="grid gap-1">
        <label htmlFor="plan-title" className="text-sm font-medium">
          What is your study called?
        </label>
        <Input id="plan-title" value={p.title} onChange={(e) => p.setTitle(e.target.value)} placeholder="e.g. Math attitude intervention" className="max-w-xl" data-testid="plan-title-input" />
      </div>
      <div className="grid gap-1">
        <label htmlFor="plan-rq" className="text-sm font-medium">
          What do you want to find out? (your research question, in plain words)
        </label>
        <textarea
          id="plan-rq"
          value={p.researchQuestion}
          onChange={(e) => p.setResearchQuestion(e.target.value)}
          rows={3}
          placeholder="e.g. Do students who get the new lessons feel better about math than students who don't?"
          className="w-full max-w-xl rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          data-testid="plan-rq-input"
        />
      </div>
      <WhyItMatters>
        <p>Writing your question down before you collect data keeps the whole study focused on it. Statly will ask a few more questions about your design next, then work out how many people you need.</p>
      </WhyItMatters>
      <div>
        <Button type="submit" disabled={!p.title.trim()} data-testid="planner-begin">
          Next: describe your design <ArrowRight aria-hidden />
        </Button>
      </div>
    </form>
  );
}

/** Study Planner (SPEC §11.2): plan a study, and its sample size, before collecting data. */
export function StudyPlannerScreen() {
  const p = usePlanner();

  useEffect(() => {
    void useAnalysisFlow.getState().loadCatalog().catch(() => undefined);
    // Reopened project with a saved plan: show it, unless the planner already holds that plan.
    const saved = projectPlan();
    if (saved && usePlanner.getState().planId !== saved.id) void usePlanner.getState().loadPlan(saved);
  }, []);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5" data-testid="planner-screen">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ClipboardList className="size-5" aria-hidden /> Study Planner
          </h1>
          <p className="text-muted-foreground">Plan your study before you collect data: your design, how many people you need, and how to set up your survey.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => p.reset()}>
          <RotateCcw aria-hidden /> Start a new plan
        </Button>
      </div>
      <Stepper />
      {p.step === "describe" && <DescribeStep />}
      {p.step === "interview" && <InterviewStep />}
      {p.step === "power" && <PowerStep />}
      {p.step === "plan" && p.plan && <PlanView plan={p.plan} />}
    </div>
  );
}
