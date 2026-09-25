import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/form";
import { VegaChart } from "@/components/charts/VegaChart";
import { Markdown } from "@/components/learn/Markdown";
import { Term } from "@/components/learn/GlossaryTerm";
import { VerdictBadge } from "@/components/results/ResultsView";
import type { AnalysisResult, AssumptionResult } from "@/contracts";
import { fmtDf, fmtNum, fmtPExpr } from "@/lib/apa";
import { isSupportedChart } from "@/lib/chartSpecs";
import { learnPageFor, sectionOf } from "@/lib/content/learn";
import { openLearn } from "@/stores/learn";

/** At or above this many scores normality tests flag harmless bumps (engine LARGE_N). */
const LARGE_N = 100;

const SCOPE_TEXT: Record<AssumptionResult["applies_to"]["kind"], string> = {
  group: "the scores in this group",
  differences: "the differences between each person's two scores",
  residuals: "the residuals (what the model couldn't explain)",
  overall: "all groups together",
};

function Block({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-1">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** One assumption, one screen (SPEC §7.2): what, why (analogy), what Statly checked, verdict, plots, meaning. */
export function AssumptionStep({ result, index, onBack, onNext }: { result: AnalysisResult; index: number; onBack: () => void; onNext: () => void }) {
  const a = result.assumptions[index];
  const total = result.assumptions.length;
  const page = learnPageFor(a.assumption);
  const what = sectionOf(page, "What it is");
  const analogy = sectionOf(page, "An everyday analogy");
  const ifFails = sectionOf(page, "What to do if it fails");
  const isNormality = a.assumption.startsWith("normality");
  const largeN = isNormality && (a.verdict === "caution" || (a.applies_to.n ?? 0) >= LARGE_N);
  const charts = a.chart_refs.filter((c) => isSupportedChart(c.chart_type, result.chart_data[c.data_key]));

  return (
    <section aria-labelledby="assumption-title" className="grid gap-5" data-testid="assumption-step">
      <div>
        <p className="text-sm text-muted-foreground" data-testid="assumption-progress">
          Assumption check {index + 1} of {total}
        </p>
        <h1 id="assumption-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
          {a.label}: {a.applies_to.label}
        </h1>
      </div>

      <Block title="What it is">{what ? <Markdown>{what}</Markdown> : <p className="text-sm">{a.label} is one of the conditions this test relies on.</p>}</Block>
      {analogy && (
        <Block title="Why it matters">
          <Markdown>{analogy}</Markdown>
        </Block>
      )}

      <Block title="What Statly checked">
        <p className="text-sm">
          Statly looked at {SCOPE_TEXT[a.applies_to.kind]}
          {a.applies_to.kind !== "overall" && ` (${a.applies_to.label})`}
          {a.applies_to.n !== null && `, ${a.applies_to.n} scores`}
          {a.test_used ? (
            <>
              {" "}using the {a.test_used.label} test
              {a.statistic && (
                <>
                  : <i>{a.statistic.symbol}</i>
                  {a.statistic.df.length > 0 && `(${fmtDf(a.statistic.df)})`} = {fmtNum(a.statistic.value)}
                </>
              )}
              {a.p !== null && (
                <>
                  , <Term k="p_value"><i>p</i></Term> {fmtPExpr(a.p)}
                </>
              )}
              .
            </>
          ) : (
            " by looking at how the study was designed."
          )}
        </p>
      </Block>

      <div className="grid gap-2 rounded-xl border p-4" data-testid="assumption-verdict" data-verdict={a.verdict}>
        <p className="flex items-center gap-2 font-semibold">
          Result <VerdictBadge verdict={a.verdict} />
        </p>
        <p className="text-sm">{a.explanation}</p>
      </div>

      {largeN && (
        <Notice tone="warn" className="flex gap-2" data-testid="large-n-caution">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>
            With {a.applies_to.n ?? "many"} scores, normality tests become very sensitive: they can flag small, harmless bumps that don't really affect a test like this one.
            Trust the plots as much as the test. If the histogram looks roughly like a hill and the Q-Q points stay close to the line, the test is usually fine.
          </span>
        </Notice>
      )}

      {charts.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {charts.map((c) => (
            <VegaChart key={c.data_key} type={c.chart_type} rows={result.chart_data[c.data_key]} title={c.title} />
          ))}
        </div>
      )}

      <Block title="What it means for you">
        {a.verdict === "passed" ? (
          <p className="text-sm">This condition looks fine, so it doesn't stand in the way of the recommended test.</p>
        ) : ifFails ? (
          <Markdown>{ifFails}</Markdown>
        ) : (
          <p className="text-sm">This is worth keeping in mind. At the end, Statly will suggest whether the recommended test or its nonparametric alternative is the safer choice.</p>
        )}
        {page && (
          <div>
            <Button variant="link" size="sm" className="h-auto px-0" onClick={() => openLearn(page.id)}>
              <BookOpen aria-hidden /> Read more about {page.title.toLowerCase()}
            </Button>
          </div>
        )}
      </Block>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft aria-hidden /> Back
        </Button>
        <Button onClick={onNext} data-testid="assumption-next">
          {index + 1 < total ? "Next check" : "Decide which test to use"} <ArrowRight aria-hidden />
        </Button>
      </div>
    </section>
  );
}
