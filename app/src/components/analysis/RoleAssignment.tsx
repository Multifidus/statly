import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckboxField, NativeSelect, Notice } from "@/components/ui/form";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import type { DatasetMeta } from "@/contracts";
import { roleLabel } from "@/lib/datasetContext";
import { labelFor } from "@/lib/content/labels";
import { catalogLabels, useAnalysisFlow } from "@/stores/analysisFlow";

/** Assign variables to the chosen analysis' roles (from `analysis.list`), pre-filled from the interview roles. */
export function RoleAssignment({ meta }: { meta: DatasetMeta }) {
  const f = useAnalysisFlow();
  const labels = catalogLabels(f.catalog);
  const rec = f.recommendation;
  const info = f.catalog?.find((x) => x.analysis_id === f.analysisId);
  const layout = info?.layouts.find((l) => l.name === f.layout) ?? info?.layouts[0];
  const choices = [rec?.primary_test, rec?.nonparametric_alternative].filter((x): x is string => !!x);
  const vars = meta.variables.filter((v) => !v.is_metadata && v.role !== "ignore").sort((a, b) => a.display_order - b.display_order);
  const varText = (name: string) => {
    const v = meta.variables.find((x) => x.name === name);
    return v?.label && v.label !== name ? `${name}: ${v.label}` : name;
  };

  return (
    <section aria-labelledby="roles-title" className="grid gap-5" data-testid="role-assignment">
      <div>
        <h1 id="roles-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
          Choose your variables
        </h1>
        <p className="text-muted-foreground">Tell Statly which columns play which part. Statly filled in its best guesses from your variable roles.</p>
      </div>

      {choices.length > 1 && (
        <div className="grid gap-1">
          <label htmlFor="flow-analysis" className="text-sm font-medium">
            Analysis
          </label>
          <NativeSelect id="flow-analysis" value={f.analysisId ?? ""} onChange={(e) => f.selectAnalysis(e.target.value)} className="max-w-md">
            {choices.map((id) => (
              <option key={id} value={id} disabled={!f.catalog?.some((a) => a.analysis_id === id)}>
                {labelFor(id, labels)}
                {id === rec?.primary_test ? " (recommended)" : " (nonparametric alternative)"}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      {!info && f.analysisId && (
        <Notice tone="warn">Statly can't run {labelFor(f.analysisId, labels)} yet. It is coming in a later version.</Notice>
      )}

      {info && info.layouts.length > 1 && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">How is your data laid out?</legend>
          <RadioGroup value={layout?.name ?? ""} onValueChange={(v) => f.setLayout(v)}>
            {info.layouts.map((l) => (
              <RadioCard key={l.name} value={l.name} id={`layout-${l.name}`} title={l.name === "wide" ? "One column per time point" : l.name === "long" ? "One row per time point (stacked)" : l.name}>
                {l.roles.map((r) => roleLabel(r.role)).join(", ")}
              </RadioCard>
            ))}
          </RadioGroup>
        </fieldset>
      )}

      {layout && (
        <div className="grid gap-4">
          {layout.roles.map((r) => {
            const id = `role-${r.role}`;
            const chosen = f.roles[r.role] ?? [];
            if (r.max === 1) {
              return (
                <div key={r.role} className="grid gap-1">
                  <label htmlFor={id} className="text-sm font-medium">
                    {roleLabel(r.role)}
                    {r.min === 0 && <span className="font-normal text-muted-foreground"> (optional)</span>}
                  </label>
                  {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                  <NativeSelect id={id} value={chosen[0] ?? ""} onChange={(e) => f.setRole(r.role, e.target.value ? [e.target.value] : [])} className="max-w-md" data-testid={id}>
                    <option value="">Choose a variable…</option>
                    {vars.map((v) => (
                      <option key={v.name} value={v.name}>
                        {varText(v.name)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              );
            }
            return (
              <fieldset key={r.role} className="grid gap-1" data-testid={id}>
                <legend className="text-sm font-medium">
                  {roleLabel(r.role)}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({r.max === null ? `${r.min} or more` : `${r.min} to ${r.max}`})
                  </span>
                </legend>
                {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                <div className="grid max-h-56 gap-1.5 overflow-auto rounded-md border p-2">
                  {vars.map((v) => (
                    <CheckboxField
                      key={v.name}
                      label={varText(v.name)}
                      checked={chosen.includes(v.name)}
                      onChange={(e) => f.setRole(r.role, e.target.checked ? [...chosen, v.name] : chosen.filter((n) => n !== v.name))}
                    />
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      )}

      {f.error && <Notice tone="error" role="alert">{f.error}</Notice>}

      <div>
        <Button onClick={() => void f.runCheck()} disabled={!info || f.busy} data-testid="flow-run">
          {f.busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null} Check the assumptions <ArrowRight aria-hidden />
        </Button>
      </div>
    </section>
  );
}
