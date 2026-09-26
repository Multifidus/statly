import { ArrowRight, Calculator, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Notice } from "@/components/ui/form";
import { WhyItMatters } from "@/components/ui/why";
import { Term } from "@/components/learn/GlossaryTerm";
import { PowerCurve } from "@/components/planner/PowerCurve";
import { statValue } from "@/lib/planner/planText";
import { allowsOneSided, BENCHMARKS, METRIC_INFO, recruitTarget } from "@/lib/planner/powerMapping";
import { nMeaning, usePlanner } from "@/stores/planner";

const fmt = (v: number | null, d = 2) => (v === null ? "—" : v.toFixed(d));

function NumberField({ id, label, value, onChange, min, max, step = 1, help }: { id: string; label: React.ReactNode; value: number | string | undefined; onChange: (v: number) => void; min?: number; max?: number; step?: number; help?: string }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input id={id} type="number" inputMode="decimal" className="max-w-40" value={value ?? ""} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

/** Step 3: pick an expected effect and settings; show n required, the power curve and a sensitivity view. */
export function PowerStep() {
  const p = usePlanner();
  const plan = p.powerPlan;
  if (!plan) return <Notice>Finish the design questions first.</Notice>;
  const s = p.settings;
  const o = s.options;
  const info = METRIC_INFO[plan.metric];
  const bench = BENCHMARKS[plan.metric];
  const design = String(o.design ?? "");
  const busy = p.powerStatus === "loading";
  const nTotal = statValue(p.apriori, "n_total");
  const nReq = statValue(p.apriori, "n_required");
  const n2 = statValue(p.apriori, "n2_required");
  const achieved = statValue(p.apriori, "achieved_power");
  const recruit = nTotal !== null ? recruitTarget(nTotal, s.dropoutPct, plan.rankBased) : null;
  const meaning = nMeaning(plan, o);
  const detectable = statValue(p.sensitivity, "detectable_effect");
  const benchTable = p.apriori?.additional_tables.find((t) => t.title.startsWith("Conventional"));

  return (
    <div className="grid gap-5">
      <Notice tone={plan.match === "fallback" ? "warn" : "info"} data-testid="power-mapping-note">
        {plan.note}
      </Notice>

      <section className="grid gap-4 rounded-xl border p-5" aria-labelledby="effect-h">
        <h2 id="effect-h" className="text-lg font-semibold">
          How big an effect do you expect?
        </h2>
        <p className="text-sm text-muted-foreground">
          The <Term k="effect_size">effect size</Term> here is {info.name}: {info.plain}.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Effect size benchmarks">
          {(Object.keys(bench) as (keyof typeof bench)[]).map((k) => (
            <Button key={k} type="button" variant={s.effect === bench[k] ? "default" : "outline"} size="sm" onClick={() => p.setSettings({ effect: bench[k] })} aria-pressed={s.effect === bench[k]} data-testid={`effect-${k}`}>
              {k[0].toUpperCase() + k.slice(1)} ({info.symbol} = {bench[k]})
            </Button>
          ))}
        </div>
        <NumberField id="effect-custom" label={`Or type your own ${info.symbol}`} value={s.effect} step={0.01} min={0} onChange={(v) => p.setSettings({ effect: v })} />
        <Notice tone="warn">
          Small, medium and large are general rules of thumb from psychology (Cohen, 1988). In education research, many real program effects are smaller than "medium" (often around {info.symbol === "d" ? "d = 0.10 to 0.30" : "the small benchmark"}). If you can, base your number on similar studies in your field.
        </Notice>
        <WhyItMatters>
          <p>The smaller the effect you want to be able to find, the more people you need. Pick the smallest effect that would still matter to you, not the one you hope for.</p>
        </WhyItMatters>
      </section>

      <section className="grid gap-4 rounded-xl border p-5" aria-labelledby="settings-h">
        <h2 id="settings-h" className="text-lg font-semibold">
          Settings
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <label htmlFor="pl-alpha" className="text-sm font-medium">
              <Term k="alpha">Significance level (alpha)</Term>
            </label>
            <NativeSelect id="pl-alpha" className="max-w-40" value={String(s.alpha)} onChange={(e) => p.setSettings({ alpha: Number(e.target.value) })}>
              <option value="0.05">.05 (usual)</option>
              <option value="0.01">.01</option>
              <option value="0.1">.10</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <label htmlFor="pl-power" className="text-sm font-medium">
              <Term k="power">Power</Term> you want
            </label>
            <NativeSelect id="pl-power" className="max-w-40" value={String(s.power)} onChange={(e) => p.setSettings({ power: Number(e.target.value) })}>
              <option value="0.8">80% (usual)</option>
              <option value="0.9">90%</option>
              <option value="0.95">95%</option>
            </NativeSelect>
          </div>
          {allowsOneSided(plan.powerId) && (
            <div className="grid gap-1">
              <label htmlFor="pl-tails" className="text-sm font-medium">
                Direction of the test
              </label>
              <NativeSelect id="pl-tails" className="max-w-56" value={s.tails} onChange={(e) => p.setSettings({ tails: e.target.value as typeof s.tails })}>
                <option value="two_sided">Either direction (two-sided, usual)</option>
                <option value="greater">Only one direction (one-sided)</option>
              </NativeSelect>
            </div>
          )}
          {plan.powerId === "power.t_test" && design === "independent" && (
            <NumberField id="pl-ratio" label="Group size ratio (group 2 ÷ group 1)" value={o.allocation_ratio} step={0.1} min={0.1} onChange={(v) => p.setOption("allocation_ratio", v)} help="1 means equal groups. Equal groups need the fewest people in total." />
          )}
          {plan.powerId === "power.anova" && design !== "rm_within" && <NumberField id="pl-groups" label="Number of groups" value={o.groups} min={2} onChange={(v) => p.setOption("groups", v)} />}
          {plan.powerId === "power.anova" && design !== "one_way" && (
            <>
              <NumberField id="pl-meas" label="Times each person is measured" value={o.measurements} min={2} onChange={(v) => p.setOption("measurements", v)} />
              <NumberField id="pl-corr" label="Expected correlation between time points" value={o.correlation} step={0.05} min={0} max={0.95} onChange={(v) => p.setOption("correlation", v)} help="How similar a person's scores are from one time to the next. 0.5 is a common guess." />
            </>
          )}
          {plan.powerId === "power.chi_square" && "categories" in o && <NumberField id="pl-cats" label="Number of categories" value={o.categories} min={2} onChange={(v) => p.setOption("categories", v)} />}
          {plan.powerId === "power.chi_square" && "rows" in o && (
            <>
              <NumberField id="pl-rows" label="Rows in your table" value={o.rows} min={2} onChange={(v) => p.setOption("rows", v)} />
              <NumberField id="pl-cols" label="Columns in your table" value={o.columns} min={2} onChange={(v) => p.setOption("columns", v)} />
            </>
          )}
          {plan.powerId === "power.regression" && (
            <>
              <NumberField id="pl-pred" label="Number of predictors" value={o.predictors} min={1} onChange={(v) => p.setOption("predictors", v)} />
              {"tested_predictors" in o && <NumberField id="pl-tested" label="Predictors added in the last step" value={o.tested_predictors} min={1} onChange={(v) => p.setOption("tested_predictors", v)} />}
            </>
          )}
          <NumberField id="pl-dropout" label="Expected drop-out (%)" value={s.dropoutPct} min={0} max={90} onChange={(v) => p.setSettings({ dropoutPct: v })} help="People who start but don't finish, or whose answers can't be used. 10–20% is common for surveys." />
        </div>
        <div>
          <Button onClick={() => void p.runPower()} disabled={busy || !(s.effect > 0)} data-testid="power-run">
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Calculator aria-hidden />} Calculate sample size
          </Button>
        </div>
        {p.powerError && (
          <Notice tone="error" role="alert">
            {p.powerError}
          </Notice>
        )}
      </section>

      {p.apriori && (
        <section className="grid gap-4 rounded-xl border border-primary/40 p-5" aria-labelledby="result-h" data-testid="power-result">
          <h2 id="result-h" className="text-lg font-semibold">
            You need about <span data-testid="power-n-total">{nTotal}</span> people in total
          </h2>
          <ul className="grid gap-1 text-sm">
            {meaning === "per group" && nReq !== null && <li>{n2 !== null && n2 !== nReq ? `${nReq} in group 1 and ${n2} in group 2` : `${nReq} per group`}</li>}
            {achieved !== null && <li>Power at this size: {Math.round(achieved * 1000) / 10}%</li>}
            {recruit !== null && recruit > (nTotal ?? 0) && (
              <li data-testid="power-recruit">
                Recruit about <strong>{recruit}</strong> to allow for {s.dropoutPct}% drop-out{plan.rankBased ? " and the extra 15% for a rank-based test" : ""}.
              </li>
            )}
          </ul>
          <p className="text-sm">{p.apriori.plain_language_summary}</p>
          {p.apriori.warnings.map((w) => (
            <Notice key={w.code} tone="warn">
              {w.message}
            </Notice>
          ))}
          <PowerCurve rows={p.apriori.chart_data.power_curve ?? []} planned={nReq} nLabel={meaning === "per group" ? "per group" : meaning === "pairs" ? "pairs" : "total"} />
          {benchTable && (
            <div className="grid gap-1 text-sm">
              <p className="font-medium">People needed for other effect sizes</p>
              <table className="w-fit text-sm" data-testid="power-benchmarks">
                <tbody>
                  {benchTable.rows.map((r, i) => (
                    <tr key={i}>
                      {r.cells.map((c, j) => (
                        <td key={j} className="pr-6 tabular-nums">
                          {c.type === "number" ? c.display : c.type === "text" ? c.text.map((t) => t.text).join("") : ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {p.apriori && (
        <section className="grid gap-3 rounded-xl border p-5" aria-labelledby="sens-h" data-testid="power-sensitivity">
          <h2 id="sens-h" className="text-lg font-semibold">
            What if you can't get that many?
          </h2>
          <p className="text-sm text-muted-foreground">
            A <Term k="sensitivity_analysis">sensitivity analysis</Term> shows the smallest effect a smaller (or larger) sample could still reliably find.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <NumberField id="pl-sens-n" label={`People you can realistically get (${meaning})`} value={p.sensitivityN ?? ""} min={2} onChange={(v) => p.setSensitivityN(Number.isFinite(v) && v > 0 ? Math.round(v) : null)} />
            <Button variant="outline" onClick={() => void p.runSensitivity()} disabled={busy || !p.sensitivityN} data-testid="sensitivity-run">
              Check
            </Button>
          </div>
          {p.sensitivity && (
            <p className="text-sm" data-testid="sensitivity-result">
              With {p.sensitivityN} {meaning === "in total" ? "people in total" : meaning === "people" ? "people" : meaning}, the smallest effect you could reliably detect is about{" "}
              <strong>
                {info.symbol} = {fmt(detectable)}
              </strong>
              . {detectable !== null && detectable > s.effect ? "That is larger than the effect you expect, so a real effect could easily be missed." : "That covers the effect you expect."}
            </p>
          )}
          <WhyItMatters>
            <p>Class sizes and school permissions often limit how many students you can survey. Knowing what your real sample can detect helps you report your study honestly. Statly doesn't compute "observed power" after the study, because it only restates the p-value.</p>
          </WhyItMatters>
        </section>
      )}

      <div>
        <Button onClick={() => p.toPlan()} disabled={!p.apriori && !p.loaded} data-testid="planner-to-plan">
          Next: see my plan <ArrowRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
