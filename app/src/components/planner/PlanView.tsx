import { useState } from "react";
import { FileDown, FolderPlus, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/form";
import { WhyItMatters } from "@/components/ui/why";
import type { PowerAnalysis, StudyPlan } from "@/contracts";
import { labelFor } from "@/lib/content/labels";
import { assumptionChecklist, CATEGORY_TITLES, RESEARCH_QUESTION_KEY } from "@/lib/planner/planText";
import { describeRpcError } from "@/lib/rpc";
import { catalogLabels, useAnalysisFlow } from "@/stores/analysisFlow";
import { useNotify } from "@/stores/notify";
import { usePlanner } from "@/stores/planner";

const SYMBOL: Record<string, string> = { d: "d", d_z: "dz", f: "f", r: "r", w: "w", f_sq: "f²" };

function PowerSummary({ pa }: { pa: PowerAnalysis }) {
  const sym = SYMBOL[pa.inputs.effect_size_metric] ?? pa.inputs.effect_size_metric;
  const o = pa.outputs;
  if (pa.mode === "a_priori") {
    return (
      <li>
        To detect an effect of {sym} = {pa.inputs.effect_size?.toFixed(2)} with {Math.round((pa.inputs.power ?? 0.8) * 100)}% power at α = {pa.inputs.alpha}: <strong>{o?.n_total ?? "—"} people in total</strong>
        {o?.n_per_group ? ` (${o.n_per_group.join(" + ")})` : ""}.
      </li>
    );
  }
  return (
    <li>
      With {pa.inputs.n_total} people, the smallest detectable effect is about {sym} = {o?.detectable_effect?.toFixed(2) ?? "—"}.
    </li>
  );
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="grid gap-2 rounded-xl border p-5" data-testid={testId}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Step 4: the plan on screen, with save / export / start-a-project actions. */
export function PlanView({ plan }: { plan: StudyPlan }) {
  const p = usePlanner();
  const catalog = useAnalysisFlow((s) => s.catalog);
  const labels = catalogLabels(catalog);
  const notify = useNotify((s) => s.show);
  const [exported, setExported] = useState<string | null>(null);
  const rq = plan.design.answers[RESEARCH_QUESTION_KEY];
  const checklist = assumptionChecklist(plan);
  const categories = (Object.keys(CATEGORY_TITLES) as (keyof typeof CATEGORY_TITLES)[]).filter((c) => plan.recommendations.some((r) => r.category === c));

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notify(describeRpcError(e), "error");
    }
  };

  return (
    <div className="grid gap-4" data-testid="plan-view">
      <div>
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Study plan</p>
        <h2 className="text-xl font-semibold" data-testid="plan-title">
          {plan.title}
        </h2>
        {typeof rq === "string" && rq && <p className="mt-1">Research question: {rq}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void act(async () => (await p.savePlanToProject()) && notify("Plan saved in your project."))} disabled={p.busy} data-testid="plan-save">
          {p.busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Save aria-hidden />} Save plan in project
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void act(async () => {
              const path = await p.exportDocx();
              if (path) {
                setExported(path);
                notify("Plan exported as a Word document.");
              }
            })
          }
          disabled={p.busy}
          data-testid="plan-export"
        >
          <FileDown aria-hidden /> Export as Word (.docx)
        </Button>
        <Button variant="outline" onClick={() => void act(() => p.startProjectFromPlan())} disabled={p.busy} data-testid="plan-start-project">
          <FolderPlus aria-hidden /> Start analysis project from this plan
        </Button>
      </div>
      {exported && (
        <Notice data-testid="plan-exported">
          Saved to <span className="font-mono text-xs break-all">{exported}</span>
        </Notice>
      )}
      <WhyItMatters title="What does “Start analysis project” do?">
        <p>It opens a new project that carries this plan. When your data are in, the Test Advisor starts with your planned answers already filled in, so your analysis matches what you planned. You can still change any answer.</p>
      </WhyItMatters>

      <Section title="Design summary" testId="plan-design">
        {plan.design.summary.split("\n").map((line, i) => (
          <p key={i} className="text-sm">
            {line}
          </p>
        ))}
      </Section>

      <Section title="Planned analyses" testId="plan-analyses">
        {plan.planned_analyses.length === 0 && <p className="text-sm text-muted-foreground">No analysis planned yet.</p>}
        {plan.planned_analyses.map((a) => (
          <div key={a.analysis_id} className="grid gap-1 border-t pt-2 first:border-t-0 first:pt-0">
            <h3 className="font-medium">{a.label}</h3>
            <p className="text-sm">{a.rationale}</p>
            {a.effect_size && <p className="text-sm text-muted-foreground">Effect size to report: {labelFor(a.effect_size, labels)}</p>}
            {a.follow_ups.length > 0 && <p className="text-sm text-muted-foreground">Follow-up tests: {a.follow_ups.map((f) => labelFor(f, labels)).join(", ")}</p>}
          </div>
        ))}
      </Section>

      <Section title="Sample size" testId="plan-power">
        {plan.power_analyses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sample-size calculation yet.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {plan.power_analyses.map((pa, i) => (
              <PowerSummary key={i} pa={pa} />
            ))}
          </ul>
        )}
        {plan.power_analyses[0]?.outputs?.method_note && <p className="text-xs text-muted-foreground">{plan.power_analyses[0].outputs.method_note}</p>}
      </Section>

      <Section title="Data collection recommendations" testId="plan-recommendations">
        {categories.map((c) => (
          <div key={c} className="grid gap-1">
            <h3 className="font-medium">{CATEGORY_TITLES[c]}</h3>
            <ul className="grid gap-2 text-sm">
              {plan.recommendations
                .filter((r) => r.category === c)
                .map((r) => (
                  <li key={r.text} className="rounded-md border p-2">
                    <p>{r.text}</p>
                    <p className="text-xs text-muted-foreground">Why it matters: {r.why}</p>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </Section>

      <Section title="Assumptions to check after you collect data" testId="plan-assumptions">
        {checklist.length ? (
          <ul className="list-disc pl-5 text-sm">
            {checklist.map((a) => (
              <li key={a}>{labelFor(a, labels)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None for the planned analyses.</p>
        )}
      </Section>
    </div>
  );
}
