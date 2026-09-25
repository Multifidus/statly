import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Input, Notice } from "@/components/ui/form";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { WhyItMatters } from "@/components/ui/why";
import type { ColumnMatch } from "@/contracts";
import type { MatchDecision } from "@/lib/importLogic";
import { useImportFlow } from "@/stores/importFlow";

export function StepStacking() {
  const preview = useImportFlow((s) => s.preview);
  const d = useImportFlow((s) => s.decisions);
  const update = useImportFlow((s) => s.update);
  if (!preview || !d) return <Notice>Statly is still reading your files…</Notice>;

  const fileName = (id: string) => preview.files.find((f) => f.file_id === id)?.name ?? id;
  const textOf = (m: ColumnMatch, i = 0) => {
    const c = m.columns[i];
    const f = preview.files.find((x) => x.file_id === c?.file_id);
    return f?.proposed_variables.find((v) => v.name === c?.column)?.question_text ?? null;
  };
  const proposal = preview.stack_proposal ?? [];
  const matched = proposal.filter((m) => m.status === "matched");
  const renamed = proposal.filter((m) => m.status === "possibly_renamed");
  const unmatched = proposal.filter((m) => m.status === "unmatched");

  const moveLevel = (from: number, to: number) => {
    const order = [...d.levelOrder];
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    update({ levelOrder: order });
  };

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">
        Statly will stack your files into one table, one row per response, with a new column saying which time point each row came from.
      </p>
      <WhyItMatters>
        <p>
          To compare time points, all answers need to be in one table with a column that says when they were
          collected. The order of the time labels here is the order they'll appear in charts and tables.
        </p>
        <p>
          Statly lines up questions across files by their short name and question text. If you edited the survey
          between rounds, a question can get a new name. Check the ones marked "possibly renamed" so the same
          question isn't split into two columns, and two different questions aren't merged by mistake.
        </p>
      </WhyItMatters>

      <section aria-labelledby="sec-time" className="grid gap-3 rounded-lg border p-4">
        <h3 id="sec-time" className="font-semibold">
          Time points
        </h3>
        <div className="grid max-w-xs gap-1.5">
          <label htmlFor="time-var" className="text-sm font-medium">
            Name of the new time column
          </label>
          <Input id="time-var" value={d.timeVariable} onChange={(e) => update({ timeVariable: e.target.value })} />
        </div>
        <ol className="grid gap-2" aria-label="Time points in order">
          {d.levelOrder.map((id, i) => (
            <li key={id} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-right text-sm tabular-nums" aria-hidden>
                {i + 1}.
              </span>
              <label htmlFor={`tl-${id}`} className="sr-only">
                Time label for {fileName(id)}
              </label>
              <Input
                id={`tl-${id}`}
                className="w-40"
                value={d.timeLabels[id] ?? ""}
                onChange={(e) => update({ timeLabels: { ...d.timeLabels, [id]: e.target.value } })}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{fileName(id)}</span>
              <Button variant="ghost" size="icon-sm" aria-label={`Move ${fileName(id)} earlier`} disabled={i === 0} onClick={() => moveLevel(i, i - 1)}>
                <ArrowUp aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${fileName(id)} later`}
                disabled={i === d.levelOrder.length - 1}
                onClick={() => moveLevel(i, i + 1)}
              >
                <ArrowDown aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      </section>

      {renamed.length > 0 && (
        <section aria-labelledby="sec-renamed" className="grid gap-3 rounded-lg border border-amber-300 p-4 dark:border-amber-800">
          <h3 id="sec-renamed" className="font-semibold">
            Possibly renamed <Badge tone="warn">{renamed.length} to check</Badge>
          </h3>
          {renamed.map((m) => (
            <fieldset key={m.variable} className="grid gap-2" data-testid={`renamed-${m.variable}`}>
              <legend className="text-sm">
                {m.columns.map((c, i) => (
                  <span key={i}>
                    {i > 0 && " and "}
                    <span className="font-mono font-medium">{c.column}</span> in {fileName(c.file_id)}
                  </span>
                ))}{" "}
                look like the same question
                {m.similarity !== null && ` (${Math.round(m.similarity * 100)}% similar wording)`}.
                {textOf(m) && <span className="block text-muted-foreground">"{textOf(m)}"</span>}
              </legend>
              <RadioGroup
                value={d.matchDecisions[m.variable] ?? ""}
                onValueChange={(v) => update({ matchDecisions: { ...d.matchDecisions, [m.variable]: v as MatchDecision } })}
                aria-label={`Is ${m.variable} the same question?`}
                className="sm:grid-cols-2"
              >
                <RadioCard id={`acc-${m.variable}`} value="accept" title="Same question: combine them">
                  Stored as <span className="font-mono">{m.variable}</span>.
                </RadioCard>
                <RadioCard id={`sep-${m.variable}`} value="separate" title="Different questions: keep separate">
                  Each gets its own column; other time points are left blank.
                </RadioCard>
              </RadioGroup>
            </fieldset>
          ))}
        </section>
      )}

      {unmatched.length > 0 && (
        <section aria-labelledby="sec-unmatched" className="grid gap-2 rounded-lg border p-4">
          <h3 id="sec-unmatched" className="font-semibold">
            Only in some files <Badge>{unmatched.length}</Badge>
          </h3>
          <p className="text-sm text-muted-foreground">These will be blank for the time points that didn't ask them. That's fine.</p>
          <ul className="grid gap-1 text-sm">
            {unmatched.map((m) => (
              <li key={m.variable}>
                <span className="font-mono">{m.variable}</span>: only in {m.columns.map((c) => fileName(c.file_id)).join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Matched in every file <Badge tone="ok">{matched.length}</Badge>
        </summary>
        <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">{matched.map((m) => m.variable).join(", ")}</p>
      </details>
    </div>
  );
}
