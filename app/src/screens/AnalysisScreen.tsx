import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssumptionStep } from "@/components/analysis/AssumptionStep";
import { DecisionStep } from "@/components/analysis/DecisionStep";
import { RoleAssignment } from "@/components/analysis/RoleAssignment";
import { useAnalysisFlow } from "@/stores/analysisFlow";
import { useDatasetStore } from "@/stores/dataset";
import { useNav } from "@/stores/nav";

/** Guided analysis: variables -> one screen per assumption -> decision -> Results (SPEC §7.2). */
export function AnalysisScreen() {
  const meta = useDatasetStore((s) => s.meta);
  const stage = useAnalysisFlow((s) => s.stage);
  const index = useAnalysisFlow((s) => s.assumptionIndex);
  const check = useAnalysisFlow((s) => s.check);
  const hasRec = useAnalysisFlow((s) => !!s.recommendation);
  const go = useNav((s) => s.go);

  useEffect(() => {
    if (stage === "done") go("results");
  }, [stage, go]);

  useEffect(() => {
    const id = stage === "roles" ? "roles-title" : stage === "assumptions" ? "assumption-title" : "decision-title";
    document.getElementById(id)?.focus();
  }, [stage, index]);

  if (!meta || !hasRec) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-3">
        <p className="text-muted-foreground">Start with the Test Advisor to choose an analysis.</p>
        <div>
          <Button onClick={() => go("advisor")}>Open the Test Advisor</Button>
        </div>
      </div>
    );
  }

  const goAssumption = useAnalysisFlow.getState().goAssumption;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4" data-testid="analysis-screen">
      <div>
        <Button variant="ghost" size="sm" onClick={() => go("advisor")}>
          <ArrowLeft aria-hidden /> Test Advisor
        </Button>
      </div>
      {stage === "roles" && <RoleAssignment meta={meta} />}
      {stage === "assumptions" && check && (
        <AssumptionStep
          result={check.result}
          index={index}
          onBack={() => (index === 0 ? useAnalysisFlow.setState({ stage: "roles" }) : goAssumption(index - 1))}
          onNext={() => goAssumption(index + 1)}
        />
      )}
      {stage === "decision" && check && (
        <DecisionStep onBack={() => goAssumption(check.result.assumptions.length - 1)} onDone={() => go("results")} />
      )}
    </div>
  );
}
