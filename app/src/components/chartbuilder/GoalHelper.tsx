import { cn } from "cn";
import { Lightbulb } from "lucide-react";
import type { ChartSpec } from "@/contracts";
import { NativeSelect } from "@/components/ui/form";
import { CHART_INFO, CHART_TYPES, GOALS } from "@/lib/chartbuilder/catalog";
import { useChartBuilder } from "@/stores/chartBuilder";

/** "What do you want to show?": pick a goal, get suggested chart types (SPEC §10.2). */
export function GoalHelper({ spec }: { spec: ChartSpec }) {
  const goal = useChartBuilder((s) => s.goal);
  const setGoal = useChartBuilder((s) => s.setGoal);
  const setType = useChartBuilder((s) => s.setType);
  const current = GOALS.find((g) => g.goal === goal);
  return (
    <section aria-labelledby="goal-heading" className="grid gap-3 rounded-lg border p-3" data-testid="goal-helper">
      <h3 id="goal-heading" className="flex items-center gap-2 text-sm font-semibold">
        <Lightbulb aria-hidden className="size-4" /> What do you want to show?
      </h3>
      <div role="radiogroup" aria-labelledby="goal-heading" className="flex flex-wrap gap-1.5">
        {GOALS.map((g) => (
          <button
            key={g.goal}
            type="button"
            role="radio"
            aria-checked={goal === g.goal}
            onClick={() => setGoal(goal === g.goal ? null : g.goal)}
            title={g.question}
            data-testid={`goal-${g.goal}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              goal === g.goal ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
      {current && (
        <div className="grid gap-1.5">
          <p className="text-sm text-muted-foreground">{current.question} Try one of these:</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {current.types.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => setType(t, true)}
                  aria-pressed={spec.chart_type === t}
                  data-testid={`suggest-${t}`}
                  className={cn(
                    "grid w-full gap-0.5 rounded-md border p-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    spec.chart_type === t ? "border-primary bg-primary/5" : "hover:bg-accent",
                  )}
                >
                  <span className="text-sm font-medium">{CHART_INFO[t].label}</span>
                  <span className="text-xs text-muted-foreground">{CHART_INFO[t].description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Chart type</span>
        <NativeSelect value={spec.chart_type} onChange={(e) => setType(e.target.value as ChartSpec["chart_type"], true)} data-testid="chart-type">
          {CHART_TYPES.map((c) => (
            <option key={c.type} value={c.type}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <p className="text-xs text-muted-foreground">{CHART_INFO[spec.chart_type].description}</p>
    </section>
  );
}
