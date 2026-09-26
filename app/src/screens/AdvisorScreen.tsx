import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, Notice } from "@/components/ui/form";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { WhyItMatters } from "@/components/ui/why";
import { RecommendationCard } from "@/components/advisor/RecommendationCard";
import type { AdvisorQuestion, AnswerValue, DatasetContext } from "@/lib/analysisRpc";
import { outcomeCandidates } from "@/lib/datasetContext";
import { answerLabel, useAdvisor } from "@/stores/advisor";
import { catalogLabels, useAnalysisFlow } from "@/stores/analysisFlow";
import { useDatasetStore } from "@/stores/dataset";
import { useNav } from "@/stores/nav";

const key = (v: AnswerValue) => JSON.stringify(v);

function contextSummary(ctx: DatasetContext): string | null {
  const parts: string[] = [];
  if (ctx.outcome_level) parts.push(ctx.outcome_level === "continuous" ? "your outcome is a score" : ctx.outcome_level === "ordinal" ? "your outcome is a rating (ordinal)" : "your outcome is a category");
  if (ctx.num_groups !== undefined) parts.push(ctx.num_groups === 1 ? "one group" : `${ctx.num_groups} groups`);
  if (ctx.num_time_points !== undefined && ctx.num_time_points > 1) parts.push(`${ctx.num_time_points} time points`);
  if (ctx.linked_mode !== undefined) parts.push(ctx.linked_mode ? "responses linked by ID" : "responses not linked across time");
  return parts.length ? parts.join(", ") : null;
}

/** One question: radio options (pre-selected with the dataset's answer), Why expander, Continue. */
function QuestionForm({ q, initial, onAnswer, busy, submitLabel = "Continue" }: { q: AdvisorQuestion; initial: AnswerValue | null; onAnswer: (v: AnswerValue) => void; busy: boolean; submitLabel?: string }) {
  const [value, setValue] = useState<string>(initial !== null ? key(initial) : "");
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
      <RadioGroup value={value} onValueChange={setValue} aria-labelledby={`q-${q.id}`}>
        {q.options.map((o, i) => (
          <RadioCard key={key(o.value)} value={key(o.value)} id={`opt-${q.id}-${i}`} title={o.label}>
            {q.auto_answer !== null && key(q.auto_answer) === key(o.value) ? "Suggested from your data" : undefined}
          </RadioCard>
        ))}
      </RadioGroup>
      <WhyItMatters>
        <p>{q.why}</p>
      </WhyItMatters>
      <div>
        <Button type="submit" disabled={!value || busy} data-testid="advisor-next">
          {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null} {submitLabel} <ArrowRight aria-hidden />
        </Button>
      </div>
    </form>
  );
}

/** Test Advisor (SPEC §7.1): one plain-language question at a time, ending on a recommendation. */
export function AdvisorScreen() {
  const meta = useDatasetStore((s) => s.meta);
  const a = useAdvisor();
  const catalog = useAnalysisFlow((s) => s.catalog);
  const setupBusy = useAnalysisFlow((s) => s.busy);
  const go = useNav((s) => s.go);
  const [editing, setEditing] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const labels = catalogLabels(catalog);

  useEffect(() => {
    if (a.status === "idle") void a.start();
    void useAnalysisFlow.getState().loadCatalog().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = a.step?.next_question ?? null;
  const rec = a.step?.recommendation ?? null;
  const current = q?.id ?? rec?.id ?? null;
  useEffect(() => {
    if (current) (document.getElementById("rec-title") ?? heading.current)?.focus();
  }, [current]);

  const candidates = meta ? outcomeCandidates(meta) : [];
  const ctxText = contextSummary(a.context);
  const hasUserAnswer = a.step?.path.some((p) => p.source === "user") ?? false;

  const setUp = async () => {
    if (!rec) return;
    await useAnalysisFlow.getState().setup(rec, a.outcome);
    go("analysis");
  };

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5" data-testid="advisor-screen">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="size-5" aria-hidden /> Test Advisor
          </h1>
          <p className="text-muted-foreground">Answer a few plain-language questions and Statly will suggest the right test.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void a.start(a.outcome)}>
          <RotateCcw aria-hidden /> Start over
        </Button>
      </div>

      {meta && (
        <div className="grid gap-1">
          <label htmlFor="advisor-outcome" className="text-sm font-medium">
            Which score or answer do you want to analyse?
          </label>
          <NativeSelect id="advisor-outcome" value={a.outcome ?? ""} onChange={(e) => void a.setOutcome(e.target.value || null)} className="max-w-md" data-testid="advisor-outcome">
            <option value="">I'm not sure yet</option>
            {candidates.map((v) => (
              <option key={v.name} value={v.name}>
                {v.label && v.label !== v.name ? `${v.name}: ${v.label}` : v.name}
              </option>
            ))}
          </NativeSelect>
          {ctxText && <p className="text-xs text-muted-foreground">From your data: {ctxText}. Statly fills in answers it can tell from this; you can change them.</p>}
        </div>
      )}

      {a.error && <Notice tone="error">{a.error}</Notice>}

      {a.step && a.step.path.length > 0 && (
        <section aria-label="Your answers so far" className="grid gap-2">
          <ol className="grid gap-2" data-testid="advisor-path">
            {a.step.path.map((p) => {
              const pq = a.questions[p.question];
              return (
                <li key={p.question} className="rounded-md border p-3 text-sm" data-testid={`path-${p.question}`} data-source={p.source}>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-muted-foreground">{pq?.text ?? p.question}</p>
                      <p className="font-medium">{answerLabel(pq, p.value)}</p>
                      {p.source === "auto" && <p className="text-xs text-muted-foreground">Filled in from your data</p>}
                      {p.source === "user" && a.planSeeded[p.question] && <p className="text-xs text-muted-foreground">Filled in from your plan</p>}
                    </div>
                    {pq && (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(editing === p.question ? null : p.question)} aria-expanded={editing === p.question} aria-label={`Change answer: ${pq.text}`}>
                        <Pencil aria-hidden /> Change
                      </Button>
                    )}
                  </div>
                  {editing === p.question && pq && (
                    <div className="mt-3">
                      <QuestionForm
                        q={pq}
                        initial={p.value}
                        busy={a.status === "loading"}
                        submitLabel="Use this answer"
                        onAnswer={(v) => {
                          setEditing(null);
                          void a.answer(p.question, v);
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

      {a.status === "loading" && !a.step && (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Getting the first question…
        </p>
      )}

      {q && (
        <section aria-labelledby={`q-${q.id}`} className="grid gap-4 rounded-xl border p-5" data-testid="advisor-question">
          <h2 id={`q-${q.id}`} ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
            {q.text}
          </h2>
          <QuestionForm q={q} initial={q.auto_answer} busy={a.status === "loading"} onAnswer={(v) => void a.answer(q.id, v)} />
        </section>
      )}

      {rec && <RecommendationCard rec={rec} labels={labels} onContinue={() => void setUp()} busy={setupBusy} />}

      {hasUserAnswer && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => void a.back()} disabled={a.status === "loading"} data-testid="advisor-back">
            <ArrowLeft aria-hidden /> Back
          </Button>
        </div>
      )}
    </div>
  );
}
