import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/form";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { WhyItMatters } from "@/components/ui/why";
import { Term } from "@/components/learn/GlossaryTerm";
import type { AdvisorQuestion, AnswerValue } from "@/lib/analysisRpc";
import { caveatText, labelFor } from "@/lib/content/labels";
import { catalogLabels, useAnalysisFlow } from "@/stores/analysisFlow";
import { answerLabel } from "@/stores/advisor";
import { usePlanner } from "@/stores/planner";

const key = (v: AnswerValue) => JSON.stringify(v);

function Question({ q, initial, onAnswer, busy, submitLabel = "Continue" }: { q: AdvisorQuestion; initial: AnswerValue | null; onAnswer: (v: AnswerValue) => void; busy: boolean; submitLabel?: string }) {
  const [value, setValue] = useState(initial !== null ? key(initial) : "");
  useEffect(() => setValue(initial !== null ? key(initial) : ""), [q.id, initial]);
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const opt = q.options.find((o) => key(o.value) === value);
        if (opt) onAnswer(opt.value);
      }}
    >
      <RadioGroup value={value} onValueChange={setValue} aria-labelledby={`pq-${q.id}`}>
        {q.options.map((o, i) => (
          <RadioCard key={key(o.value)} value={key(o.value)} id={`popt-${q.id}-${i}`} title={o.label} />
        ))}
      </RadioGroup>
      <WhyItMatters>
        <p>{q.why}</p>
      </WhyItMatters>
      <div>
        <Button type="submit" disabled={!value || busy} data-testid="planner-next">
          {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null} {submitLabel} <ArrowRight aria-hidden />
        </Button>
      </div>
    </form>
  );
}

/** Step 2: the advisor's design interview with no dataset, so every question is asked. */
export function InterviewStep() {
  const p = usePlanner();
  const catalog = useAnalysisFlow((s) => s.catalog);
  const labels = catalogLabels(catalog);
  const heading = useRef<HTMLHeadingElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const q = p.advisorStep?.next_question ?? null;
  const rec = p.advisorStep?.recommendation ?? null;

  useEffect(() => {
    heading.current?.focus();
  }, [q?.id, rec?.id]);

  return (
    <div className="grid gap-4">
      {p.error && <Notice tone="error">{p.error}</Notice>}
      {p.advisorStep && p.advisorStep.path.length > 0 && (
        <section aria-label="Your answers so far">
          <ol className="grid gap-2" data-testid="planner-path">
            {p.advisorStep.path.map((s) => {
              const pq = p.questions[s.question];
              return (
                <li key={s.question} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-muted-foreground">{pq?.text ?? s.question}</p>
                      <p className="font-medium">{answerLabel(pq, s.value)}</p>
                    </div>
                    {pq && (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(editing === s.question ? null : s.question)} aria-expanded={editing === s.question} aria-label={`Change answer: ${pq.text}`}>
                        Change
                      </Button>
                    )}
                  </div>
                  {editing === s.question && pq && (
                    <div className="mt-3">
                      <Question
                        q={pq}
                        initial={s.value}
                        busy={p.status === "loading"}
                        submitLabel="Use this answer"
                        onAnswer={(v) => {
                          setEditing(null);
                          void p.answer(s.question, v);
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {p.status === "loading" && !p.advisorStep && (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Getting the first question…
        </p>
      )}

      {q && (
        <section aria-labelledby={`pq-${q.id}`} className="grid gap-4 rounded-xl border p-5" data-testid="planner-question">
          <h2 id={`pq-${q.id}`} ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
            {q.text}
          </h2>
          <Question q={q} initial={null} busy={p.status === "loading"} onAnswer={(v) => void p.answer(q.id, v)} />
        </section>
      )}

      {rec && (
        <section aria-labelledby="planner-rec" className="grid gap-3 rounded-xl border border-primary/40 p-5" data-testid="planner-recommendation">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Your planned analysis</p>
            <h2 id="planner-rec" ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">
              {labelFor(rec.primary_test, labels)}
            </h2>
          </div>
          <WhyItMatters title="Why this test?">
            <p>{rec.why_this_test}</p>
          </WhyItMatters>
          {rec.caveats.map((c) => (
            <Notice key={c} tone="warn">
              {caveatText(c)}
            </Notice>
          ))}
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {rec.nonparametric_alternative && (
              <div>
                <dt className="font-medium">
                  Backup if assumptions don't hold (<Term k="nonparametric">nonparametric</Term>)
                </dt>
                <dd>{labelFor(rec.nonparametric_alternative, labels)}</dd>
              </div>
            )}
            {rec.assumptions.length > 0 && (
              <div>
                <dt className="font-medium">Assumptions to check later</dt>
                <dd>{rec.assumptions.map((a) => labelFor(a, labels)).join(", ")}</dd>
              </div>
            )}
            {rec.effect_size.length > 0 && (
              <div>
                <dt className="font-medium">
                  <Term k="effect_size">Effect size</Term> to report
                </dt>
                <dd>{labelFor(rec.effect_size[0], labels)}</dd>
              </div>
            )}
          </dl>
          <div>
            <Button onClick={() => p.toPower()} data-testid="planner-to-power">
              Next: how many people? <ArrowRight aria-hidden />
            </Button>
          </div>
        </section>
      )}

      {p.advisorStep && p.advisorStep.path.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => void p.back()} disabled={p.status === "loading"}>
            <ArrowLeft aria-hidden /> Back
          </Button>
        </div>
      )}
    </div>
  );
}
