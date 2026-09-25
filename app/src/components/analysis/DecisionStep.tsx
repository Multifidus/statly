import { useState } from "react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/form";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { Term } from "@/components/learn/GlossaryTerm";
import { VerdictBadge } from "@/components/results/ResultsView";
import { labelFor } from "@/lib/content/labels";
import { alternativeFor, catalogLabels, suggestedChoice, useAnalysisFlow, type Choice } from "@/stores/analysisFlow";

/** Final decision (SPEC §7.2): the user chooses; Statly confirms or gently explains a concern. */
export function DecisionStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const f = useAnalysisFlow();
  const labels = catalogLabels(f.catalog);
  const result = f.check!.result;
  const alt = alternativeFor(f.analysisId, f.recommendation);
  const altAvailable = !!alt && !!f.catalog?.some((a) => a.analysis_id === alt);
  const suggestion = suggestedChoice(result, altAvailable);
  const [choice, setChoice] = useState<Choice>(suggestion.choice);
  const primaryLabel = labelFor(f.analysisId!, labels);
  const altLabel = alt ? labelFor(alt, labels) : null;

  const confirm = async () => {
    if (await f.choose(choice)) onDone();
  };

  return (
    <section aria-labelledby="decision-title" className="grid gap-5" data-testid="decision-step">
      <div>
        <h1 id="decision-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
          Which test should you use?
        </h1>
        <p className="text-muted-foreground">Here is what the checks found. You make the final choice.</p>
      </div>

      <ul className="grid gap-2">
        {result.assumptions.map((a, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <VerdictBadge verdict={a.verdict} /> {a.label}: {a.applies_to.label}
          </li>
        ))}
      </ul>

      <Notice tone="info" data-testid="decision-suggestion">
        <span className="font-medium">Statly suggests: {suggestion.choice === "recommended" ? primaryLabel : altLabel}. </span>
        {suggestion.reason}
      </Notice>

      <RadioGroup value={choice} onValueChange={(v) => setChoice(v as Choice)} aria-labelledby="decision-title">
        <RadioCard value="recommended" id="choice-recommended" title={<>Use the recommended test: {primaryLabel} {suggestion.choice === "recommended" && <Badge tone="ok">Suggested</Badge>}</>}>
          A <Term k="parametric">parametric</Term> test: compares averages and is the most powerful choice when its assumptions hold.
        </RadioCard>
        {altLabel && (
          <RadioCard value="alternative" id="choice-alternative" title={<>Use the nonparametric alternative: {altLabel} {suggestion.choice === "alternative" && <Badge tone="ok">Suggested</Badge>}</>}>
            {altAvailable ? "Works with ranks instead of raw scores, so it doesn't need bell-shaped data." : "Statly can't run this test yet."}
          </RadioCard>
        )}
      </RadioGroup>

      {choice !== suggestion.choice ? (
        <Notice tone="warn" data-testid="decision-concern">
          {choice === "recommended"
            ? "That's your call to make. Just mention the assumption concern when you report the result, and check the plots to be sure they look reasonable."
            : "That's fine: the nonparametric test is always a safe choice. It is a little less powerful when the assumptions actually hold, so a real difference is slightly harder to detect."}
        </Notice>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="size-4" aria-hidden /> This matches Statly's suggestion.
        </p>
      )}

      {f.error && <Notice tone="error" role="alert">{f.error}</Notice>}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft aria-hidden /> Back
        </Button>
        <Button onClick={() => void confirm()} disabled={f.busy || (choice === "alternative" && !altAvailable)} data-testid="decision-confirm">
          {f.busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null} Run and see the results
        </Button>
      </div>
    </section>
  );
}
