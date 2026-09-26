import { familywiseErrorRate } from "@/lib/testFamilies";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The false-positive problem with a concrete example (SPEC §9; content/learn multiple_comparisons). */
export function FalsePositiveExplainer({ k }: { k?: number }) {
  return (
    <div className="grid gap-2 text-sm leading-relaxed" data-testid="false-positive-explainer">
      <p>
        Each test has about a 5% chance of a false positive: a “significant” result when nothing real is going on. Those chances add up.
        Run 10 independent tests at alpha = .05 where there is truly no difference, and the chance that at least one comes out significant
        by luck alone is 1 − (1 − .05)<sup>10</sup> = {pct(familywiseErrorRate(10))}.
      </p>
      {k !== undefined && k >= 2 && (
        <p data-testid="false-positive-k">
          With the {k} tests selected here, that chance is {pct(familywiseErrorRate(k))} instead of 5%.
        </p>
      )}
      <p>
        Grouping related tests into a <em>family</em> and correcting their p-values keeps that overall risk in check. Statly never does this
        on its own: you decide which tests belong together and which correction to use. Judge significance by the adjusted p-value.
      </p>
    </div>
  );
}
