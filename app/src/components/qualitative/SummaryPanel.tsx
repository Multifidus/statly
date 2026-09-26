import { useEffect, useState } from "react";
import { Table2 } from "lucide-react";
import type { DatasetMeta } from "@/contracts";
import { Button } from "@/components/ui/button";
import { NativeSelect, Notice } from "@/components/ui/form";
import type { CreatedVariable } from "@/lib/qualitative/types";
import { useNav } from "@/stores/nav";
import { groupingVariables, useQualitative } from "@/stores/qualitative";
import { TagBarChart } from "./TagBarChart";
import { Swatch } from "./TagChip";

const pct = (p: number | null) => (p === null ? "—" : `${p.toFixed(1)}%`);

/** Counts and percentages per tag, overall and by a group/time variable, plus yes/no variables. */
export function SummaryPanel({ meta }: { meta: DatasetMeta }) {
  const variable = useQualitative((s) => s.variable);
  const summary = useQualitative((s) => s.summary);
  const summaryBy = useQualitative((s) => s.summaryBy);
  const loadSummary = useQualitative((s) => s.loadSummary);
  const makeVariables = useQualitative((s) => s.makeVariables);
  const go = useNav((s) => s.go);
  const [created, setCreated] = useState<CreatedVariable[] | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = groupingVariables(meta);

  useEffect(() => {
    if (!summary) void loadSummary();
  }, [summary, loadSummary, variable]);

  if (!summary) return <p className="text-sm text-muted-foreground">Counting tags…</p>;
  const tags = summary.tags;
  const byTag = new Map(summary.overall.map((c) => [c.tag_id, c]));

  const make = async () => {
    setBusy(true);
    setCreated(await makeVariables());
    setBusy(false);
  };

  return (
    <div className="grid gap-5" data-testid="qual-summary">
      <p className="text-sm">
        <strong>{summary.n_responses}</strong> people wrote an answer to {summary.variable}. <strong>{summary.n_coded}</strong> of them (
        {pct(summary.n_responses ? (100 * summary.n_coded) / summary.n_responses : null)}) have at least one tag, and{" "}
        {summary.n_uncoded} are not tagged yet. One answer can have several tags, so the percentages can add up to more than 100%.
      </p>
      {tags.length === 0 ? (
        <Notice>Add tags to the codebook and tag some responses to see a summary here.</Notice>
      ) : (
        <>
          <label className="grid w-fit gap-1 text-xs font-medium">
            Compare by
            <NativeSelect value={summaryBy ?? ""} onChange={(e) => void loadSummary(e.target.value || null)} data-testid="qual-summary-by">
              <option value="">Everyone together</option>
              {groups.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                  {v.label ? ` — ${v.label}` : ""}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="qual-summary-table">
              <caption className="sr-only">Number and percent of responses with each tag</caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-1 pr-3 font-medium">Tag</th>
                  <th scope="col" className="py-1 pr-3 font-medium">All ({summary.n_responses})</th>
                  {summary.groups.map((g) => (
                    <th key={String(g.value)} scope="col" className="py-1 pr-3 font-medium">
                      {g.label} ({g.n_responses})
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tags.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <th scope="row" className="py-1 pr-3 text-left font-normal">
                      <span className="inline-flex items-center gap-2">
                        <Swatch color={t.color} /> {t.name}
                      </span>
                    </th>
                    <td className="py-1 pr-3 tabular-nums">
                      {byTag.get(t.id)?.count ?? 0} ({pct(byTag.get(t.id)?.percent ?? null)})
                    </td>
                    {summary.groups.map((g) => {
                      const c = g.counts.find((x) => x.tag_id === t.id);
                      return (
                        <td key={String(g.value)} className="py-1 pr-3 tabular-nums">
                          {c?.count ?? 0} ({pct(c?.percent ?? null)})
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summary.n_missing_group > 0 && (
            <p className="text-xs text-muted-foreground">
              {summary.n_missing_group} answer{summary.n_missing_group === 1 ? " is" : "s are"} left out of the group columns because{" "}
              {summary.by} is missing for {summary.n_missing_group === 1 ? "that person" : "those people"}.
            </p>
          )}
          <TagBarChart
            summary={summary}
            title={summary.by ? `Percent of responses with each tag, by ${summary.by}` : "Percent of responses with each tag"}
          />
          <section aria-labelledby="yesno-title" className="grid gap-2 rounded-md border p-3">
            <h3 id="yesno-title" className="text-sm font-semibold">
              Compare groups with a chi-square test
            </h3>
            <p className="text-sm">
              Statly can turn each tag into a yes/no variable: <strong>1 (Yes)</strong> if a person's answer has the tag and{" "}
              <strong>0 (No)</strong> if it doesn't. People who left the question blank are marked missing. You can then test whether a
              theme shows up more often in one group than another.
            </p>
            <div>
              <Button size="sm" onClick={() => void make()} disabled={busy} data-testid="make-yes-no">
                <Table2 aria-hidden /> Make yes/no variables
              </Button>
            </div>
            {created && (
              <div role="status" className="grid gap-2 text-sm" data-testid="yes-no-created">
                <ul className="list-disc pl-5">
                  {created.map((c) => (
                    <li key={c.variable}>
                      <strong>{c.variable}</strong> {c.updated ? "(updated)" : "(new)"}: {c.n_yes} yes, {c.n_no} no
                      {c.n_missing ? `, ${c.n_missing} missing` : ""}
                    </li>
                  ))}
                </ul>
                <p>
                  Next: open <strong>Analyze</strong>, say you want to compare groups on a yes/no (category) outcome, and pick one of these
                  variables with your group variable. Statly will suggest a chi-square test of independence (or Fisher's exact test when
                  groups are small). If you tag more answers later, press the button again to update the variables.
                </p>
                <div>
                  <Button size="sm" variant="outline" onClick={() => go("advisor")}>
                    Go to Analyze
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
