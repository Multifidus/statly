import { AlertTriangle, BookOpen, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "cn";
import type { AnalysisResult, AssumptionResult, EffectSize, ResultWarning } from "@/contracts";
import { ApaTableView } from "@/components/results/ApaTableView";
import { CopyButton } from "@/components/results/CopyButton";
import { RichText } from "@/components/results/RichText";
import { Term } from "@/components/learn/GlossaryTerm";
import { Markdown } from "@/components/learn/Markdown";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/form";
import { fmtDf, fmtNum, fmtPExpr, isBounded, sentencePayload } from "@/lib/apa";
import { learnPageFor, sectionOf } from "@/lib/content/learn";
import { primaryEffect, primaryStatistic } from "@/lib/resultSummary";
import { openLearn } from "@/stores/learn";

function Section({ id, title, children, className }: { id: string; title: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id + "-h"} className={cn("grid gap-3 rounded-xl border p-5", className)} data-testid={id}>
      <h2 id={id + "-h"} className="text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

const VERDICT = {
  passed: { icon: CheckCircle2, label: "Looks fine", tone: "ok" as const },
  caution: { icon: AlertTriangle, label: "Caution", tone: "warn" as const },
  failed: { icon: XCircle, label: "Concern", tone: "warn" as const },
};

export function VerdictBadge({ verdict }: { verdict: AssumptionResult["verdict"] }) {
  const v = VERDICT[verdict];
  return (
    <Badge tone={v.tone} className="inline-flex items-center gap-1">
      <v.icon className="size-3.5" aria-hidden /> {v.label}
    </Badge>
  );
}

function effectText(e: EffectSize): string {
  const b = isBounded(e.key);
  const ci = e.ci && e.ci.lower !== null && e.ci.upper !== null ? `, ${Math.round(e.ci.level * 100)}% CI [${fmtNum(e.ci.lower, 2, b)}, ${fmtNum(e.ci.upper, 2, b)}]` : "";
  return ` = ${fmtNum(e.value, 2, b)}${ci}`;
}

function WarningNote({ w }: { w: ResultWarning }) {
  return (
    <Notice tone={w.severity === "serious" ? "error" : w.severity === "caution" ? "warn" : "info"} className="flex gap-2">
      {w.severity === "info" ? <Info className="size-4 shrink-0" aria-hidden /> : <AlertTriangle className="size-4 shrink-0" aria-hidden />}
      <span>{w.message}</span>
    </Notice>
  );
}

/**
 * Generic Results screen body for any AnalysisResult (SPEC §10.1): plain-language summary
 * first, key numbers, APA sentence (copy), APA tables, effect sizes, assumptions,
 * descriptives, warnings and "How to report this" from the Learn page.
 */
export function ResultsView({ result, title, badge }: { result: AnalysisResult; title: string; badge?: React.ReactNode }) {
  const stat = primaryStatistic(result);
  const effect = primaryEffect(result);
  const page = learnPageFor(result.analysis_id);
  const howTo = sectionOf(page, /^How to report/);
  const groupCount = result.inputs.n_by_group.length;

  return (
    <div className="grid gap-4" data-testid="results-view">
      <div>
        <h1 id="results-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">
          {result.inputs.n_used} {result.inputs.n_used === 1 ? "response" : "responses"} analysed
          {result.inputs.n_excluded > 0 && `, ${result.inputs.n_excluded} left out for missing answers`}
          {groupCount > 1 && ` (${result.inputs.n_by_group.map((g) => `${Object.values(g.group).join(", ")}: ${g.n}`).join("; ")})`}.
        </p>
        {badge && <div className="mt-2">{badge}</div>}
      </div>

      <Section id="result-summary" title="What this means" className="border-primary/30 bg-accent/30">
        <p className="text-base leading-relaxed" data-testid="plain-summary">
          {result.plain_language_summary}
        </p>
        {(stat || effect) && (
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {stat && stat.value !== null && (
              <div>
                <dt className="text-muted-foreground">{stat.label}</dt>
                <dd className="font-serif text-base tabular-nums">
                  <i>{stat.symbol}</i>
                  {stat.df.length > 0 && `(${fmtDf(stat.df)})`} = {fmtNum(stat.value, 2, isBounded(stat.key))}, <Term k="p_value"><i>p</i></Term> {fmtPExpr(stat.p)}
                </dd>
              </div>
            )}
            {effect && (
              <div>
                <dt className="text-muted-foreground">
                  <Term k="effect_size">Effect size</Term>: {effect.label}
                </dt>
                <dd className="font-serif text-base tabular-nums">
                  <i>{effect.symbol}</i>
                  {effectText(effect)}
                </dd>
              </div>
            )}
          </dl>
        )}
      </Section>

      {result.warnings.length > 0 && (
        <div className="grid gap-2" data-testid="result-warnings">
          {result.warnings.map((w, i) => (
            <WarningNote key={`${w.code}-${i}`} w={w} />
          ))}
        </div>
      )}

      <Section id="result-apa-sentence" title="APA results sentence">
        <p className="font-serif text-base leading-relaxed" data-testid="apa-sentence">
          <RichText runs={result.apa_sentence} />
        </p>
        <div>
          <CopyButton payload={() => sentencePayload(result.apa_sentence)} label="Copy sentence" testId="copy-sentence" />
        </div>
      </Section>

      {(result.apa_table || result.additional_tables.length > 0) && (
        <Section id="result-tables" title="APA table">
          {result.apa_table && <ApaTableView table={result.apa_table} testId="apa-table" />}
          {result.additional_tables.map((t, i) => (
            <ApaTableView key={i} table={t} fallbackNumber={(result.apa_table?.number ?? 1) + i + 1} testId={`apa-table-${i + 2}`} />
          ))}
        </Section>
      )}

      {result.effect_sizes.length > 0 && (
        <Section id="result-effects" title={<>How big is the difference? (<Term k="effect_size">effect size</Term>)</>}>
          <ul className="grid gap-3">
            {result.effect_sizes.map((e) => (
              <li key={`${e.key}-${e.term ?? ""}`} className="grid gap-1">
                <p className="text-sm">
                  <span className="font-medium">{e.label}</span>
                  {e.term && <span className="text-muted-foreground"> ({e.term})</span>}:{" "}
                  <span className="font-serif tabular-nums">
                    <i>{e.symbol}</i>
                    {effectText(e)}
                  </span>
                  {e.interpretation && <Badge className="ml-2">{e.interpretation.magnitude}</Badge>}
                </p>
                {e.interpretation && <p className="text-sm text-muted-foreground">{e.interpretation.text}</p>}
                {learnPageFor(e.key) && (
                  <div>
                    <Button variant="link" size="sm" className="h-auto px-0" onClick={() => openLearn(learnPageFor(e.key)!.id)}>
                      <BookOpen aria-hidden /> About {e.label}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            The <Term k="confidence_interval">confidence interval</Term> shows the range of sizes that fit your data.
          </p>
        </Section>
      )}

      {result.assumptions.length > 0 && (
        <Section id="result-assumptions" title="Assumption checks">
          <ul className="grid gap-2">
            {result.assumptions.map((a, i) => (
              <li key={i} className="grid gap-1 rounded-md border p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {a.label} <span className="font-normal text-muted-foreground">({a.applies_to.label})</span> <VerdictBadge verdict={a.verdict} />
                </p>
                <p className="text-sm">{a.explanation}</p>
                {a.test_used && (
                  <p className="text-xs text-muted-foreground">
                    {a.test_used.label}
                    {a.statistic && (
                      <>
                        : <i>{a.statistic.symbol}</i>
                        {a.statistic.df.length > 0 && `(${fmtDf(a.statistic.df)})`} = {fmtNum(a.statistic.value)}
                      </>
                    )}
                    {a.p !== null && (
                      <>
                        , <i>p</i> {fmtPExpr(a.p)}
                      </>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(result.descriptives.continuous.length > 0 || result.descriptives.frequencies.length > 0) && (
        <Section id="result-descriptives" title="Descriptive statistics">
          {result.descriptives.continuous.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-1 pr-3 font-medium">Variable</th>
                    <th className="py-1 pr-3 font-medium">Group</th>
                    <th className="py-1 pr-3 text-right font-medium"><i>n</i></th>
                    <th className="py-1 pr-3 text-right font-medium"><Term k="mean"><i>M</i></Term></th>
                    <th className="py-1 pr-3 text-right font-medium"><Term k="standard_deviation"><i>SD</i></Term></th>
                    <th className="py-1 pr-3 text-right font-medium"><Term k="median"><i>Mdn</i></Term></th>
                    <th className="py-1 pr-3 text-right font-medium">Min</th>
                    <th className="py-1 text-right font-medium">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {result.descriptives.continuous.map((d, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-3">{d.variable}</td>
                      <td className="py-1 pr-3">{Object.keys(d.group).length ? d.label : "All"}</td>
                      <td className="py-1 pr-3 text-right">{d.n}</td>
                      <td className="py-1 pr-3 text-right">{fmtNum(d.mean)}</td>
                      <td className="py-1 pr-3 text-right">{fmtNum(d.sd)}</td>
                      <td className="py-1 pr-3 text-right">{fmtNum(d.median)}</td>
                      <td className="py-1 pr-3 text-right">{fmtNum(d.min)}</td>
                      <td className="py-1 text-right">{fmtNum(d.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.descriptives.frequencies.map((f, i) => (
            <div key={i} className="overflow-x-auto">
              <p className="text-sm font-medium">
                {f.variable}
                {Object.keys(f.group).length > 0 && ` (${Object.values(f.group).join(", ")})`}
              </p>
              <table className="text-sm tabular-nums">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-1 pr-3 font-medium">Answer</th>
                    <th className="py-1 pr-3 text-right font-medium">Count</th>
                    <th className="py-1 text-right font-medium">%</th>
                  </tr>
                </thead>
                <tbody>
                  {f.levels.map((l, j) => (
                    <tr key={j}>
                      <td className="py-0.5 pr-3">{l.label}</td>
                      <td className="py-0.5 pr-3 text-right">{l.count}</td>
                      <td className="py-0.5 text-right">{fmtNum(l.percent, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Section>
      )}

      <Section id="result-how-to-report" title="How to report this">
        {howTo ? <Markdown>{howTo}</Markdown> : <p className="text-sm">Report the test, its statistic with degrees of freedom, the exact p-value, and the effect size with its confidence interval, as in the sentence above.</p>}
        {page && (
          <div>
            <Button variant="outline" size="sm" onClick={() => openLearn(page.id)} data-testid="open-learn-page">
              <BookOpen aria-hidden /> Learn more about the {page.title}
            </Button>
          </div>
        )}
      </Section>
    </div>
  );
}
