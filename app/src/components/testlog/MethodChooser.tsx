import type { CorrectionMethod } from "@/contracts";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { METHOD_INFO, METHOD_ORDER, type ChosenMethod } from "@/lib/testFamilies";

/** Guided choice of Bonferroni / Holm / Benjamini-Hochberg, each explained with when to choose it. */
export function MethodChooser({
  value,
  onChange,
  idPrefix,
}: {
  value: CorrectionMethod | null;
  onChange: (m: ChosenMethod) => void;
  idPrefix: string;
}) {
  return (
    <RadioGroup
      value={value && value !== "none" ? value : ""}
      onValueChange={(v) => onChange(v as ChosenMethod)}
      aria-label="Correction method"
      data-testid="method-chooser"
    >
      {METHOD_ORDER.map((m) => (
        <div key={m} data-testid={`method-${m}`}>
          <RadioCard value={m} id={`${idPrefix}-${m}`} title={METHOD_INFO[m].label + (m === "holm" ? " (a good default)" : "")}>
            {METHOD_INFO[m].what} <span className="font-medium text-foreground">When to choose it:</span> {METHOD_INFO[m].when}
          </RadioCard>
        </div>
      ))}
    </RadioGroup>
  );
}
